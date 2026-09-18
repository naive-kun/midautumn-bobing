"""Original modal synthesis: dice striking a glazed ceramic bowl, not a recording.
Generate reusable PCM samples for WebAudio and Douyin InnerAudioContext.
"""
import math
import random
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'public' / 'audio'
OUT.mkdir(parents=True, exist_ok=True)
RATE = 44100
DURATION = .50
# Non-harmonic ceramic resonances with a dry attack and short ringing decay.
MODES = [(1740, .74, .115), (2805, .30, .074), (4320, .12, .043), (6410, .038, .024)]
VARIANTS = [('clink.wav', 1.0, 1.0, 41), ('clink-soft.wav', .989, .83, 42), ('clink-bright.wav', 1.012, 1.12, 43)]

for name, tuning, brightness, seed in VARIANTS:
    rng = random.Random(seed)
    samples = []
    prior_noise = 0
    for i in range(round(RATE * DURATION)):
        t = i / RATE
        attack = 1 - math.exp(-t / .00038)
        value = 0
        for index, (frequency, amplitude, decay) in enumerate(MODES):
            gain = amplitude * (brightness if index > 0 else 1)
            # Weak split modes add the beating of a physical bowl, with no pitch sweep.
            mode = math.sin(math.tau * frequency * tuning * t)
            mode += .11 * math.sin(math.tau * (frequency * tuning + 9 + index * 4) * t)
            value += gain * mode * math.exp(-t / decay)
        noise = rng.uniform(-1, 1)
        dry_attack = (noise - prior_noise) * .045 * math.exp(-t / .0026)
        prior_noise = noise
        body = .12 * math.sin(math.tau * 790 * t) * math.exp(-t / .011)
        # Fade the final tail to zero to avoid a cut-off click at the end of the file.
        fade = min(1, max(0, (DURATION - t) / .035))
        samples.append((value + body + dry_attack) * attack * fade)
    scale = .76 / max(abs(value) for value in samples)
    pcm = [round(value * scale * 32767) for value in samples]
    with wave.open(str(OUT / name), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(struct.pack('<' + 'h' * len(pcm), *pcm))
    rms = math.sqrt(sum((value / 32767) ** 2 for value in pcm) / len(pcm))
    print(f'{name}: {len(pcm)} samples, {DURATION:.2f}s, peak=.76, rms={rms:.3f}')
