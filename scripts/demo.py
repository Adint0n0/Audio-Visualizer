"""Generate the original bundled demo. Uses only Python's standard library."""
import array
import math
import random
import wave
from pathlib import Path

rate = 24000
tempo = 112
beat = 60 / tempo
duration = 32 * beat
rng = random.Random(421)
pcm = array.array('h')
roots = [130.8128, 103.8262, 155.5635, 116.5409]
tau = math.tau
for index in range(round(rate * duration)):
    t = index / rate
    step = int(t / beat)
    q = t % beat
    eighth = t % (beat / 2)
    root = roots[step // 8 % 4]
    note = root * [2, 2.9966, 2.3784, 3.5636, 2.9966, 4, 2.3784, 2.6697][int(t / (beat / 2)) % 8]
    kick = .39 * math.exp(-q * 16) * math.sin(tau * (47*q + 1.75*(1-math.exp(-q*34))))
    hat = rng.uniform(-1,1) * (.10 * math.exp(-eighth*75) + (.14 * math.exp(-q*27) if step % 4 in (1,3) else 0))
    bass = .19 * math.sin(tau * root*.5 * t) * math.exp(-q*3)
    bell = .15 * math.exp(-eighth*10) * (1-math.exp(-eighth*200)) * (math.sin(tau*note*t) + .28*math.sin(tau*2*note*t))
    fade = min(1,t/.012,(duration-t)/.14)
    for side in [-1,1]:
        pad = sum(math.sin(tau*root*r*t + side*.28) for r in [1,1.1892,1.4983])*.027
        pcm.append(round(29000*fade*(kick+hat+bass+bell*(1+side*.14)+pad)))
target = Path(__file__).resolve().parents[1] / 'public/demo/phase-drift.wav'
target.parent.mkdir(exist_ok=True)
with wave.open(str(target),'wb') as dest:
    dest.setparams((2,2,rate,0,'NONE','not compressed'))
    dest.writeframes(pcm.tobytes())
