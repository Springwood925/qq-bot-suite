"""Small bounded VAD for 48 kHz stereo PCM, independent of devices."""
import audioop
import collections
import io
import wave

class VoiceActivity:
    def __init__(self,threshold=.025,sample_rate=48000):
        self.threshold=threshold;self.rate=sample_rate;self.reset()
    def reset(self):
        self.pre=collections.deque(maxlen=15);self.parts=[];self.talking=False
        self.voiced=0;self.silence=0;self.total=0;self.notified=False
    def push(self,stereo):
        mono=audioop.tomono(stereo,2,.5,.5)
        ms=len(mono)/2/self.rate*1000
        voiced=audioop.rms(mono,2)/32768>self.threshold
        events=[]
        if not self.talking:
            self.pre.append(stereo)
            if not voiced:return events
            self.talking=True;self.parts=list(self.pre);self.pre.clear();self.voiced=ms;self.total=ms;self.silence=0
        else:
            self.parts.append(stereo);self.total+=ms
            if voiced:self.voiced+=ms;self.silence=0
            else:self.silence+=ms
        if self.voiced>=180 and not self.notified:
            self.notified=True;events.append(('speech',None))
        if self.silence>=850 or self.total>=12000:
            if self.voiced>=180:
                output=io.BytesIO()
                with wave.open(output,'wb') as wav:
                    wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(self.rate);wav.writeframes(b''.join(self.parts))
                events.append(('audio',output.getvalue()))
            self.reset()
        return events
