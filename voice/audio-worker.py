"""Background audio device worker; never opens an input device while idle."""
import base64
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent/'audio-runtime'))
import sounddevice as sd
from audio_vad import VoiceActivity

sys.stdout.reconfigure(encoding='utf-8',line_buffering=True)
write_lock=threading.Lock()
def emit(event,**fields):
    with write_lock:print(json.dumps({'type':event,**fields},ensure_ascii=True),flush=True)

class Worker:
    def __init__(self):
        self.input_name='Voicemeeter Out B1';self.output_name='Voicemeeter AUX Input'
        self.threshold=.025;self.running=False;self.stream=None;self.stop_capture=None;self.capture_thread=None
        self.stop_play=None;self.play_thread=None;self.audio_queue=queue.Queue(maxsize=200)
    def devices(self):
        hostapis=sd.query_hostapis();items=sd.query_devices()
        def collect(direction):
            key='max_input_channels' if direction=='input' else 'max_output_channels'
            return [x['name'] for x in items if x[key]>=2 and hostapis[x['hostapi']]['name']=='Windows WASAPI']
        return {'inputs':collect('input'),'outputs':collect('output')}
    def device(self,prefix,direction):
        hostapis=sd.query_hostapis();items=sd.query_devices()
        key='max_input_channels' if direction=='input' else 'max_output_channels'
        choices=[(i,x['name']) for i,x in enumerate(items) if x[key]>=2 and hostapis[x['hostapi']]['name']=='Windows WASAPI']
        matches=[i for i,n in choices if n==prefix] or [i for i,n in choices if n.startswith(prefix)]
        if len(matches)!=1:raise RuntimeError('找不到唯一的'+('输入' if direction=='input' else '输出')+'设备：'+prefix)
        return matches[0]
    def status(self):
        try:emit('devices',**self.devices(),input=self.input_name,output=self.output_name,threshold=self.threshold)
        except Exception as e:emit('error',message='无法读取音频设备：'+str(e))
    def start(self):
        if self.running:return
        self.stop_capture=threading.Event(); stop=self.stop_capture
        try:
            selected=self.device(self.input_name,'input')
            def callback(indata,frames,timing,status):
                if stop.is_set():return
                try:self.audio_queue.put_nowait(bytes(indata))
                except queue.Full:pass
            self.stream=sd.RawInputStream(samplerate=48000,blocksize=960,device=selected,channels=2,dtype='int16',callback=callback)
            self.stream.start();self.running=True
            self.capture_thread=threading.Thread(target=self.capture,args=(stop,),daemon=True);self.capture_thread.start()
            emit('state',state='listening')
        except Exception as e:
            if self.stream:self.stream.close();self.stream=None
            self.running=False;emit('error',message='无法开始监听：'+str(e))
    def capture(self,stop):
        vad=VoiceActivity(threshold=self.threshold);last_level=0
        while not stop.is_set():
            try:data=self.audio_queue.get(timeout=.2)
            except queue.Empty:continue
            try:
                for kind,payload in vad.push(data):
                    if kind=='speech':self.interrupt();emit('speech')
                    elif kind=='audio':emit('audio',data=base64.b64encode(payload).decode('ascii'))
            except Exception as e:emit('error',message='音频处理失败：'+str(e));break
        while True:
            try:self.audio_queue.get_nowait()
            except queue.Empty:break
    def interrupt(self):
        if self.stop_play:self.stop_play.set()
    def play(self,ident,data):
        self.interrupt()
        # One active playback stream at a time; join the interrupted predecessor.
        if self.play_thread:self.play_thread.join(timeout=2)
        stop=threading.Event();self.stop_play=stop
        def run():
            status='done'
            try:
                target=self.device(self.output_name,'output')
                with sd.RawOutputStream(samplerate=48000,blocksize=960,device=target,channels=2,dtype='int16') as stream:
                    for pos in range(0,len(data),3840):
                        if stop.is_set():status='interrupted';break
                        stream.write(data[pos:pos+3840])
            except Exception as e:status='error';emit('error',message='语音播放失败：'+str(e))
            emit('play_done',id=ident,status=status)
        self.play_thread=threading.Thread(target=run,daemon=True);self.play_thread.start()
    def stop(self):
        self.interrupt()
        if self.stop_capture:self.stop_capture.set()
        if self.stream:
            try:self.stream.stop();self.stream.close()
            except Exception:pass
        if self.capture_thread:self.capture_thread.join(timeout=1)
        self.capture_thread=None;self.stream=None;self.running=False;emit('state',state='idle')

w=Worker();w.status()
for line in sys.stdin:
    try:
        cmd=json.loads(line);kind=cmd.get('type')
        if kind=='start':w.start()
        elif kind=='stop':w.stop()
        elif kind=='interrupt':w.interrupt()
        elif kind=='devices':w.status()
        elif kind=='configure':
            if w.running:emit('error',message='请在通话结束后修改音频设备')
            else:
                w.input_name=str(cmd.get('input') or w.input_name);w.output_name=str(cmd.get('output') or w.output_name)
                w.threshold=max(.005,min(.12,float(cmd.get('threshold') or .025)));w.status()
        elif kind=='play':w.play(str(cmd.get('id','')),base64.b64decode(cmd.get('data',''),validate=True))
    except Exception as e:emit('error',message='音频服务异常：'+str(e))
w.stop()
