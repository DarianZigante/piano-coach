#!/usr/bin/env python3
"""Render note events to a mono WAV that imitates a piano heard through a laptop microphone.

usage: render.py scenario.json out.wav [--inst sal|sf2] [--noise -55] [--reverb 0.3] [--hp 0] [--gain -12] [--detune 0]
scenario.json: {"events": [[onset_s, midi, dur_s, vel], ...], "tail": 1.0}
"""
import sys, os, json, subprocess, argparse
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
SAL_DIR = os.path.join(HERE, '..', 'audio', 'salamander')
SAL_NOTES = {'A0': 21, 'C1': 24, 'Ds1': 27, 'Fs1': 30, 'A1': 33, 'C2': 36, 'Ds2': 39, 'Fs2': 42, 'A2': 45,
             'C3': 48, 'Ds3': 51, 'Fs3': 54, 'A3': 57, 'C4': 60, 'Ds4': 63, 'Fs4': 66, 'A4': 69, 'C5': 72,
             'Ds5': 75, 'Fs5': 78, 'A5': 81, 'C6': 84, 'Ds6': 87, 'Fs6': 90, 'A6': 93, 'C7': 96}
_sal = {}


def sal_sample(name):
    if name not in _sal:
        raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', os.path.join(SAL_DIR, name + '.mp3'), '-f', 'f32le',
                              '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
        x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
        # trim leading silence (mp3 encoder delay)
        thr = 0.01 * np.max(np.abs(x))
        start = max(0, int(np.argmax(np.abs(x) > thr)) - 48)
        _sal[name] = x[start:]
    return _sal[name]


def sal_note(midi, dur, vel, detune_cents=0.0):
    name = min(SAL_NOTES, key=lambda k: abs(SAL_NOTES[k] - midi))
    base = SAL_NOTES[name]
    x = sal_sample(name)
    ratio = 2 ** ((midi - base + detune_cents / 100.0) / 12.0)
    n_out = int(len(x) / ratio)
    idx = np.arange(n_out) * ratio
    y = np.interp(idx, np.arange(len(x)), x)
    n = min(len(y), int((dur + 0.25) * SR))
    y = y[:n].copy()
    rel = int(0.12 * SR)  # damper release
    d = int(dur * SR)
    if d < n:
        env = np.ones(n)
        k = min(rel, n - d)
        env[d:d + k] = np.linspace(1, 0, k) ** 2
        env[d + k:] = 0
        y *= env
    return y * (0.25 + 0.75 * vel)


def render_sal(events, total, detune):
    out = np.zeros(int(total * SR))
    for (t, m, d, v) in events:
        y = sal_note(int(m), d, v, detune)
        i = int(t * SR)
        k = min(len(y), len(out) - i)
        if k > 0:
            out[i:i + k] += y[:k]
    return out


def render_sf2(events, total, detune, program=0):
    import tinysoundfont, pretty_midi
    path = os.path.join(os.path.dirname(pretty_midi.__file__), 'TimGM6mb.sf2')
    synth = tinysoundfont.Synth(samplerate=SR)
    sfid = synth.sfload(path)
    synth.program_select(0, sfid, 0, program)
    acts = []
    for (t, m, d, v) in events:
        acts.append((t, 1, int(m), int(30 + 97 * v)))
        acts.append((t + d, 0, int(m), 0))
    acts.sort(key=lambda a: (a[0], a[1]))
    out = []
    pos = 0
    for (t, on, m, v) in acts:
        n = int(t * SR) - pos
        if n > 0:
            buf = np.frombuffer(synth.generate(n), dtype=np.float32).reshape(-1, 2).mean(axis=1)
            out.append(buf.copy())
            pos += n
        if on:
            synth.noteon(0, m, v)
        else:
            synth.noteoff(0, m)
    n = int(total * SR) - pos
    if n > 0:
        out.append(np.frombuffer(synth.generate(n), dtype=np.float32).reshape(-1, 2).mean(axis=1).copy())
    return np.concatenate(out).astype(np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scenario')
    ap.add_argument('out')
    ap.add_argument('--inst', default='sal')
    ap.add_argument('--noise', type=float, default=-58.0, help='noise floor dBFS rms')
    ap.add_argument('--reverb', type=float, default=0.25, help='RT60 seconds (0 = dry)')
    ap.add_argument('--hp', type=float, default=0.0, help='high-pass corner Hz (small speakers)')
    ap.add_argument('--gain', type=float, default=-10.0, help='peak level dBFS')
    ap.add_argument('--detune', type=float, default=0.0, help='global detune in cents')
    ap.add_argument('--program', type=int, default=0)
    ap.add_argument('--sr', type=int, default=48000)
    a = ap.parse_args()
    sc = json.load(open(a.scenario))
    ev = sc['events']
    total = max(t + d for (t, m, d, v) in ev) + sc.get('tail', 1.0)
    rng = np.random.default_rng(7)
    x = render_sal(ev, total, a.detune) if a.inst == 'sal' else render_sf2(ev, total, a.detune, a.program)
    if a.reverb > 0:
        n = int(a.reverb * SR)
        ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
        ir *= 0.25 / np.sqrt(np.sum(ir ** 2))
        ir[0] = 1.0
        x = signal.fftconvolve(x, ir)[:len(x)]
    if a.hp > 0:
        sos = signal.butter(2, a.hp, 'hp', fs=SR, output='sos')
        x = signal.sosfilt(sos, x)
    pk = np.max(np.abs(x)) + 1e-12
    x = x / pk * 10 ** (a.gain / 20)
    # pinkish room noise + a little 60 Hz hum
    w = rng.standard_normal(len(x))
    b, aa = signal.butter(1, 400, 'lp', fs=SR)
    pink = signal.lfilter(b, aa, w) * 3 + w * 0.3
    pink *= 10 ** (a.noise / 20) / (np.std(pink) + 1e-12)
    t = np.arange(len(x)) / SR
    hum = 10 ** ((a.noise - 6) / 20) * np.sin(2 * np.pi * 60 * t)
    x = x + pink + hum
    if a.sr != SR:
        x = signal.resample_poly(x, a.sr, SR)
    sf.write(a.out, x.astype(np.float32), a.sr, subtype='FLOAT')
    print('wrote', a.out, round(len(x) / a.sr, 2), 's')


if __name__ == '__main__':
    main()
