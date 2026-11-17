#!/usr/bin/env python3
# הפסקול של הטריילר: מוזיקה מקורית שנוצרת כולה בקוד (numpy בלבד, דטרמיניסטי).
# פלט: work/audio/master.wav – 48kHz, 16bit, סטריאו, בדיוק 2,160,000 דגימות (45.000 שניות).
# מבנה (128 BPM, 24 תיבות): פתיחה עם מכות -> כותרת בחצי קצב -> גרוב מלא -> אפקטים של אירועים
# (מוות, סירנה, "עצירת סרט") -> ברייקדאון ליום/שקיעה/לילה -> גרוב -> מכות -> אקורד סיום שדועך.
import json, os, wave
import numpy as np

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, '..', 'timeline.json'), encoding='utf-8'))
BPM, BARS = T['bpm'], T['bars']
BEAT = SR * 60 // BPM                      # 22500 דגימות לפעימה
assert BEAT * BPM == SR * 60
N = BEAT * 4 * BARS                        # 2,160,000
rng = np.random.default_rng(1911)


def b2s(beat):
    return int(round(beat * BEAT))


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, sig, start, gain=1.0, pan=0.0):
    """מוסיף צליל (מונו או סטריאו) לערוץ סטריאו. pan: -1 שמאל .. 1 ימין."""
    start = int(start)
    if start < 0:
        sig, start = sig[-start:], 0
    n = min(len(sig), N - start)
    if n <= 0:
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        buf[start:start + n, 0] += sig[:n] * (gain * np.cos(a) * 1.41421356)
        buf[start:start + n, 1] += sig[:n] * (gain * np.sin(a) * 1.41421356)
    else:
        buf[start:start + n] += sig[:n] * gain


def edges(sig, a=0.002, r=0.01):
    """כניסה ויציאה רכות, כדי שלא יהיו קליקים."""
    sig = sig.copy()
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    na, nr = min(na, len(sig)), min(nr, len(sig))
    sig[:na] = (sig[:na].T * np.linspace(0, 1, na)).T
    sig[-nr:] = (sig[-nr:].T * np.linspace(1, 0, nr)).T
    return sig


def norm(sig):
    return sig / (np.max(np.abs(sig)) + 1e-12)


def band(x, lo=None, hi=None, order=3):
    """מסנן סטטי בתחום התדר (ללא scipy)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * g, n)


def osc(freq, n, kind='saw', fmax=6000.0, hdecay=0.0, phase=0.0):
    """גל מסור/ריבועי מוגבל-פס בסינתזה אדיטיבית. hdecay: הרמוניות גבוהות דועכות מהר יותר (פילטר נסגר)."""
    t = np.arange(n) / SR
    if np.isscalar(freq):
        ph, top = 2 * np.pi * freq * t + phase, float(freq)
    else:
        ph, top = 2 * np.pi * np.cumsum(freq) / SR + phase, float(np.max(freq))
    out = np.zeros(n)
    K = max(1, int(fmax // top))
    for k in range(1, K + 1):
        if kind == 'sq' and k % 2 == 0:
            continue
        a = 1.0 / k
        a *= min(1.0, (K + 1 - k) / 3.0)          # ריכוך של ההרמוניות העליונות
        if hdecay:
            out += a * np.exp(-t * hdecay * (k - 1)) * np.sin(k * ph)
        else:
            out += a * np.sin(k * ph)
    return out * 0.6


def sweep_noise(n, c0, c1, width=0.8):
    """רעש שמרכז הפס שלו גולש מ-c0 ל-c1 הרץ (בנק פסים סטטיים עם מעבר רך ביניהם)."""
    X = np.fft.rfft(rng.standard_normal(n))
    lf = np.log2(np.maximum(np.fft.rfftfreq(n, 1 / SR), 1.0))
    lc = np.log2(np.geomspace(c0, c1, n))
    out = np.zeros(n)
    for c in np.log2(np.geomspace(120, 15000, 16)):
        w = np.exp(-0.5 * ((lc - c) / width) ** 2)
        if w.max() < 1e-3:
            continue
        out += np.fft.irfft(X * np.exp(-0.5 * ((lf - c) / 0.3) ** 2), n) * w
    return norm(out)


# ---------- תופים ----------
def make_kick():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 47 + 105 * np.exp(-t / 0.036) + 70 * np.exp(-t / 0.007)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.17)
    click = band(rng.standard_normal(n), 1500, 7000) * np.exp(-t / 0.004) * 0.3
    return edges(norm(np.tanh(1.8 * (body + click))), 0.0004, 0.03)


def make_clap():
    n = int(0.36 * SR)
    t = np.arange(n) / SR
    noise = band(rng.standard_normal(n), 800, 9500, 2)
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.024):
        env += np.where(t >= d, np.exp(-np.maximum(t - d, 0) / 0.011), 0.0) * 0.5
    env += np.exp(-t / 0.085) * 0.55
    body = np.sin(2 * np.pi * 188 * t) * np.exp(-t / 0.045) * 0.45
    return edges(norm(noise * env * 2.2 + body), 0.0003, 0.03)


def make_hat(is_open):
    n = int((0.24 if is_open else 0.07) * SR)
    t = np.arange(n) / SR
    noise = band(rng.standard_normal(n), 7500, None, 3)
    return edges(norm(noise * np.exp(-t / (0.075 if is_open else 0.013))), 0.0003, 0.01)


def make_impact(big):
    n = int((3.0 if big else 1.3) * SR)
    t = np.arange(n) / SR
    f = 36 + 75 * np.exp(-t / 0.05)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.6 if big else 0.28))
    rumble = band(rng.standard_normal(n), 50, 2200 if big else 3200, 2) * np.exp(-t / (0.5 if big else 0.2)) * 2.0
    crack = band(rng.standard_normal(n), 1800, 9000, 2) * np.exp(-t / 0.03) * 1.2
    return edges(norm(np.tanh(1.4 * (sub + 0.55 * rumble + 0.5 * crack))), 0.0004, 0.05)


KICK, CLAP, HAT_C, HAT_O = make_kick(), make_clap(), make_hat(False), make_hat(True)
IMPACT, HIT = make_impact(True), make_impact(False)


# ---------- אקורדים ----------
CH = {  # bass, pad (midi), arp (midi)
    'Am': (33, [45, 57, 60, 64], [69, 72, 76, 81]),
    'F': (29, [41, 57, 60, 65], [69, 72, 77, 81]),
    'C': (36, [48, 55, 60, 64], [67, 72, 76, 79]),
    'G': (31, [43, 55, 59, 62], [67, 71, 74, 79]),
}
BAR_CH = ['Am', 'Am', 'Am', 'F', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G',
          'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C', 'C', 'C']
MODE = ['intro', 'intro', 'half', 'half'] + ['groove'] * 9 + ['break'] * 3 + ['groove'] * 4 + ['stabs'] + ['final'] * 3
ARP_PAT = [0, 2, 1, 3, 2, 3, 1, 2, 0, 2, 1, 3, 2, 3, 1, 3]
LEAD = [  # מוטיב של 4 תיבות: (פעימה בתוך התיבה, אורך בפעימות, תו)
    [(0, 1.5, 76), (1.5, 0.5, 74), (2, 1, 72), (3, 1, 69)],
    [(0, 1.5, 72), (1.5, 0.5, 74), (2, 2, 76)],
    [(0, 1.5, 79), (1.5, 0.5, 76), (2, 1, 74), (3, 1, 72)],
    [(0, 3, 74)],
]

drums = np.zeros((N, 2)); bass = np.zeros((N, 2)); pad_lo = np.zeros((N, 2)); pad_hi = np.zeros((N, 2))
arp = np.zeros((N, 2)); lead = np.zeros((N, 2)); sfx = np.zeros((N, 2)); sfx_wet = np.zeros((N, 2))
kicks = []                                   # מיקומי קיק, בשביל ה"פמפום" (sidechain)


def add_kick(beat, gain=1.0):
    place(drums, KICK, b2s(beat), 0.78 * gain)
    kicks.append((b2s(beat), gain))


def pad_chord(notes, start, n, gain=1.0, tau=None):
    """פד חם: שלושה מסורים מעט מזויפים לכל תו, מפוזרים בסטריאו. נשמר בנפרד חלק נמוך וחלק בהיר."""
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.06)
    if tau:
        env = env * np.exp(-t / tau)
    env = edges(env, 0.001, 0.12)
    lo = np.zeros((n, 2)); hi = np.zeros((n, 2))
    for m in notes:
        for cents, pan in ((-9, -0.8), (0, 0.0), (9, 0.8)):
            f = hz(m) * 2 ** (cents / 1200)
            ph0 = rng.uniform(0, 2 * np.pi)
            a = (pan + 1) * np.pi / 4
            gl, gr = np.cos(a), np.sin(a)
            k = 1
            while k * f < 5200:
                amp = (1.0 / k) / np.sqrt(1 + (k * f / 3200) ** 4)
                s = amp * np.sin(k * (2 * np.pi * f * t + ph0))
                tgt = lo if k * f < 700 else hi
                tgt[:, 0] += s * gl; tgt[:, 1] += s * gr
                k += 1
    place(pad_lo, lo * env[:, None], start, 0.11 * gain)
    place(pad_hi, hi * env[:, None], start, 0.11 * gain)


def bass_note(m, start, n, gain=1.0, hd=7.0):
    t = np.arange(n) / SR
    s = osc(hz(m), n, 'saw', 2800, hd * 0.55) + 0.3 * np.sin(2 * np.pi * hz(m) * t)
    env = np.minimum(1.0, t / 0.004) * (0.72 + 0.28 * np.exp(-t / 0.08))
    place(bass, edges(s * env, 0.001, 0.012), start, 0.36 * gain)


def arp_note(m, start, gain=1.0):
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    s = (osc(hz(m), n, 'saw', 8000, 9.0) + 0.6 * osc(hz(m) * 1.003, n, 'sq', 8000, 12.0)) * np.exp(-t / 0.16)
    place(arp, edges(s, 0.001, 0.02), start, 0.3 * gain, pan=rng.uniform(-0.35, 0.35))


def lead_note(m, start, n, gain=1.0):
    t = np.arange(n) / SR
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.14) / 0.2, 0, 1)
    f = hz(m) * vib
    s = osc(f, n, 'saw', 5500, 2.5) + 0.7 * osc(f * 1.004, n, 'sq', 5500, 3.5)
    env = np.minimum(1.0, t / 0.008) * (0.6 + 0.4 * np.exp(-t / 0.5))
    place(lead, edges(s * env, 0.001, 0.05), start, 0.23 * gain)


def snare_roll(beat0, beats, div=8, g0=0.25, g1=0.95):
    k = int(round(beats * div))
    for i in range(k):
        place(drums, CLAP, b2s(beat0 + i / div), (g0 + (g1 - g0) * (i / max(1, k - 1)) ** 1.6) * 0.55)


# ---------- העיבוד, תיבה אחרי תיבה ----------
for bar in range(BARS):
    b0 = bar * 4
    mode = MODE[bar]
    root, padn, arpn = CH[BAR_CH[bar]]
    L = b2s(4)
    if mode == 'intro':
        pad_chord([33, 45, 52], b2s(b0), L + 3000, 0.9)                       # רחש נמוך וכהה
    elif mode == 'half':
        pad_chord(padn, b2s(b0), L + 3000)
        bass_note(root, b2s(b0), b2s(3.9), 0.8, hd=14.0)
        add_kick(b0, 1.0); add_kick(b0 + 2.5, 0.7)
        place(drums, CLAP, b2s(b0 + 2), 0.5)
        for i in range(8):
            place(drums, HAT_C, b2s(b0 + i / 2), 0.12, pan=0.25)
        if bar == 3:                                                           # הארפג'ו נכנס בהדרגה
            for i in range(16):
                arp_note(arpn[ARP_PAT[i]], b2s(b0 + i / 4), 0.25 + 0.75 * i / 15)
    elif mode == 'groove':
        pad_chord(padn, b2s(b0), L + 3000)
        for i in range(8):                                                     # בס באוקטבות, שמיניות
            bass_note(root + (12 if i % 2 else 0), b2s(b0 + i / 2), b2s(0.5) - 300)
        for i in range(4):
            add_kick(b0 + i)
            place(drums, HAT_C, b2s(b0 + i), 0.2, pan=0.25)
            place(drums, HAT_C, b2s(b0 + i + 0.25), 0.1, pan=0.25)
            place(drums, HAT_O, b2s(b0 + i + 0.5), 0.3, pan=0.25)
            place(drums, HAT_C, b2s(b0 + i + 0.75), 0.12, pan=0.25)
        place(drums, CLAP, b2s(b0 + 1), 0.64); place(drums, CLAP, b2s(b0 + 3), 0.64)
        if bar in (7, 19):                                                     # מעבר קטן בסוף המשפט
            place(drums, CLAP, b2s(b0 + 3.5), 0.3); place(drums, CLAP, b2s(b0 + 3.75), 0.42)
        events = 8 <= bar <= 11                                                # בתיבות האירועים המוזיקה דלילה יותר
        for i in range(16):
            arp_note(arpn[ARP_PAT[i]], b2s(b0 + i / 4), 0.55 if events else 1.0)
        if bar in (4, 5, 6, 7, 16, 17, 18, 19):
            for (bt, ln, m) in LEAD[bar % 4]:
                lead_note(m, b2s(b0 + bt), b2s(ln) - 400)
    elif mode == 'break':
        pad_chord(padn, b2s(b0), L + 3000, 1.15)
        bass_note(root + 12, b2s(b0), b2s(3.95), 0.55, hd=20.0)
        g = (bar - 13) / 3
        for i in range(16):
            arp_note(arpn[ARP_PAT[i]] + (12 if bar == 15 and i >= 8 else 0), b2s(b0 + i / 4), 0.55 + 0.45 * (g + i / 48))
        if bar == 15:
            snare_roll(b0 + 2, 1, 4, 0.2, 0.5); snare_roll(b0 + 3, 0.94, 8, 0.5, 1.0)
    elif mode == 'stabs':
        for bt, name in ((0, 'F'), (2, 'G')):
            r, pn, _ = CH[name]
            pad_chord(pn + [pn[-1] + 12], b2s(b0 + bt), b2s(1.6), 1.5, tau=0.35)
            bass_note(r, b2s(b0 + bt), b2s(1.2), 1.0)
            add_kick(b0 + bt)
    elif mode == 'final' and bar == 21:
        n = N - b2s(b0)
        pad_chord([36, 48, 55, 60, 64, 67, 72], b2s(b0), n, 1.5, tau=2.3)      # דו מז'ור רחב שמצלצל ודועך
        t = np.arange(n) / SR
        s = (osc(hz(36), n, 'saw', 1500, 3.0) + 0.6 * np.sin(2 * np.pi * hz(36) * t)) * np.exp(-t / 1.6)
        place(bass, edges(s, 0.003, 0.3), b2s(b0), 0.5)
        add_kick(b0)
        up = [60, 64, 67, 72, 76, 79, 84, 88, 84, 79, 76, 72, 76, 79, 84, 88] * 2
        for i, m in enumerate(up):                                             # נצנוץ שעולה ונמוג
            arp_note(m, b2s(b0 + i / 4), 0.9 * np.exp(-i / 14))
        for (bt, ln, m) in ((0, 0.5, 76), (0.5, 0.5, 79), (1, 3.5, 84)):      # תרועה קצרה
            lead_note(m, b2s(b0 + bt), b2s(ln), 1.1)

# ---------- אפקטים לפי timeline.json ----------
def riser(beat_end, beats):
    n = b2s(beats)
    x = np.arange(n) / n
    s = sweep_noise(n, 250, 9000) * x ** 2.2 * 0.8
    tone = np.sin(2 * np.pi * np.cumsum(np.geomspace(180, 1500, n)) / SR) * x ** 2.5 * 0.25
    place(sfx, edges(s + tone, 0.01, 0.006), b2s(beat_end) - n, 0.5)


def whoosh(beat, lead_in):
    n = b2s(0.95)
    x = np.arange(n) / n
    s = sweep_noise(n, 500, 7000) if lead_in else sweep_noise(n, 900, 5000)
    env = np.sin(np.pi * x ** (0.6 if lead_in else 1.0)) ** 2
    st = b2s(beat) if lead_in else b2s(beat) - n // 2
    stereo = np.stack([s * env * (1 - 0.6 * x), s * env * (0.4 + 0.6 * x)], 1)   # נע משמאל לימין
    place(sfx, stereo, st, 0.34)


def death(beat):
    n = int(1.5 * SR)
    t = np.arange(n) / SR
    f = 185 * 2 ** (-1.7 * t)
    buzz = osc(f, n, 'sq', 2600, 1.2) * (0.72 + 0.28 * np.sign(np.sin(2 * np.pi * 31 * t)))
    thud = np.sin(2 * np.pi * np.cumsum(42 + 90 * np.exp(-t / 0.04)) / SR) * np.exp(-t / 0.22)
    s = buzz * np.exp(-t / 0.55) * 0.75 + thud * 1.1
    place(sfx, edges(np.tanh(1.3 * s), 0.001, 0.1), b2s(beat), 0.62)
    place(sfx_wet, edges(s, 0.001, 0.1), b2s(beat), 0.12)


def siren(beat, beats):
    n = b2s(beats)
    t = np.arange(n) / SR
    step = (np.arange(n) // (BEAT // 2)) % 2                                    # שני טונים שמתחלפים כל חצי פעימה
    f = np.where(step == 0, hz(81), hz(77)).astype(float)
    k = int(0.02 * SR)
    f = np.convolve(np.pad(f, k, mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), 'valid')   # גלישה קצרה בין הטונים
    s = osc(f, n, 'sq', 5000, 0.0) * 0.6 + osc(f, n, 'saw', 4000, 0.0) * 0.3
    env = np.minimum(1.0, t / 0.03) * np.clip((n - np.arange(n)) / (0.6 * BEAT), 0, 1)
    pan = np.where(step == 0, -0.55, 0.55)
    k2 = int(0.01 * SR)
    pan = np.convolve(np.pad(pan, k2, mode='edge'), np.ones(2 * k2 + 1) / (2 * k2 + 1), 'valid')
    a = (pan + 1) * np.pi / 4
    place(sfx, np.stack([s * env * np.cos(a), s * env * np.sin(a)], 1), b2s(beat), 0.34)


def blips(beat, beats):
    scale = [79, 81, 83, 86, 88, 91, 93, 95]
    for i in range(int(beats * 2)):
        n = int(0.16 * SR)
        t = np.arange(n) / SR
        f = hz(scale[i % len(scale)])
        s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t / 0.045)
        place(sfx, edges(s, 0.001, 0.01), b2s(beat + i / 2), 0.2, pan=-0.4 + 0.8 * i / 7)
        place(sfx_wet, edges(s, 0.001, 0.01), b2s(beat + i / 2), 0.05)


def pop(beat):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(520 + 1100 * (1 - np.exp(-t / 0.018))) / SR) * np.exp(-t / 0.035)
    place(sfx, edges(s, 0.0005, 0.01), b2s(beat), 0.55)
    m = int(0.2 * SR)
    t2 = np.arange(m) / SR
    spark = (np.sin(2 * np.pi * hz(96) * t2) + np.sin(2 * np.pi * hz(100) * t2)) * np.exp(-t2 / 0.06)
    place(sfx, edges(spark, 0.001, 0.01), b2s(beat) + int(0.07 * SR), 0.16, pan=0.3)
    place(sfx_wet, edges(spark, 0.001, 0.01), b2s(beat) + int(0.07 * SR), 0.08)


def dive(beat):
    n = b2s(1.6)
    x = np.arange(n) / n
    s = sweep_noise(n, 8000, 220) * (1 - x) ** 1.3
    sub = np.sin(2 * np.pi * np.cumsum(np.geomspace(130, 34, n)) / SR) * np.exp(-x * 3.2)
    place(sfx, edges(s * 0.5 + sub * 0.9, 0.001, 0.05), b2s(beat), 0.5)


cues = T['sfx']
for c in cues:
    b, ty = c['beat'], c['type']
    if ty == 'impact':
        place(sfx, IMPACT, b2s(b), 0.85); place(sfx_wet, IMPACT, b2s(b), 0.3)
    elif ty == 'hit':
        place(sfx, HIT, b2s(b), 0.7); place(sfx_wet, HIT, b2s(b), 0.2)
    elif ty == 'riser':
        riser(b + c.get('beats', 1), max(2, c.get('beats', 1)))
    elif ty == 'whoosh':
        whoosh(b, any(o['beat'] == b + 1 and o['type'] in ('dive', 'impact') for o in cues))
    elif ty == 'dive':
        dive(b)
    elif ty == 'death':
        death(b)
    elif ty == 'siren':
        siren(b, c.get('beats', 4))
    elif ty == 'blips':
        blips(b, c.get('beats', 4))
    elif ty == 'pop':
        pop(b)
    elif ty == 'roll':
        snare_roll(b, c.get('beats', 1) * 0.94, 8, 0.3, 1.0)
    elif ty == 'tapestop':
        n = int(1.2 * SR)                                                       # צניחה נמוכה שמלווה את "עצירת הסרט"
        x = np.arange(n) / n
        place(sfx, edges(np.sin(2 * np.pi * np.cumsum(np.geomspace(95, 30, n)) / SR) * (1 - x) ** 1.5, 0.004, 0.05), b2s(b), 0.45)
        m = b2s(1)                                                              # שאיפה חזרה אל הגרוב
        xm = np.arange(m) / m
        place(sfx, edges(sweep_noise(m, 400, 8000) * xm ** 2.5, 0.01, 0.005), b2s(b + 3), 0.3)
        place(drums, CLAP, b2s(b + 3.5), 0.32); place(drums, CLAP, b2s(b + 3.75), 0.45)


# ---------- עיבוד סופי ----------
def delay(x, beats=0.75, fb=0.42, taps=6):
    """דיליי של שמינית מנוקדת, מקפץ בין הערוצים."""
    d = b2s(beats)
    out = np.zeros_like(x)
    for k in range(1, taps + 1):
        src = x[:, ::-1] if k % 2 else x
        if k * d < N:
            out[k * d:] += src[:N - k * d] * fb ** k
    return out


def reverb(x, rt=1.7, seed=7):
    """ריוורב פשוט: קונבולוציה עם רעש שדועך אקספוננציאלית."""
    r = np.random.default_rng(seed)
    n = int(rt * 1.4 * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    size = 1 << int(np.ceil(np.log2(N + n)))
    for ch in range(2):
        ir = band(r.standard_normal(n) * np.exp(-t * 6.9 / rt), 280, 6500, 2)
        ir[:int(0.012 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[:N]
    return out


# "פמפום" של הבס, הפד והארפג'ו עם כל קיק
sc = np.ones(N)
n_sc = int(0.4 * SR)
t_sc = np.arange(n_sc) / SR
for pos, g in kicks:
    m = min(n_sc, N - pos)
    sc[pos:pos + m] *= 1 - 0.68 * g * np.exp(-t_sc[:m] / 0.105) * np.minimum(1.0, t_sc[:m] / 0.004)
sc2 = sc[:, None]

# בהירות הפד: כהה בפתיחה, נפתח בכותרת, נפתח בהדרגה בברייקדאון (כמו פילטר שנפתח)
bright = np.zeros(N)
def ramp(b_from, b_to, v0, v1):
    a, b = b2s(b_from), b2s(b_to)
    bright[a:b] = np.linspace(v0, v1, b - a)
ramp(0, 8, 0.05, 0.3); ramp(8, 16, 0.4, 1.0); ramp(16, 52, 1.0, 1.0)
ramp(52, 64, 0.15, 1.4); ramp(64, 80, 1.05, 1.05); ramp(80, 96, 1.4, 1.4)
pad = pad_lo + pad_hi * bright[:, None]

arp_bus = arp + delay(arp) * 0.55
lead_bus = lead + delay(lead, 0.75, 0.35, 4) * 0.4
music = drums + bass * sc2 + pad * (0.25 + 0.75 * sc2) + arp_bus * (0.45 + 0.55 * sc2) + lead_bus * (0.55 + 0.45 * sc2)
music += reverb(pad * 0.35 + arp_bus * 0.5 + lead_bus * 0.6 + drums * 0.08, 1.8, 7) * 0.5

# "עצירת סרט" בפעימה 40: המוזיקה מאטה וצונחת בגובה במשך שתי פעימות, ואז שקט עד פעימה 44
ts = next((c['beat'] for c in cues if c['type'] == 'tapestop'), None)
if ts is not None:
    s0, Ls = b2s(ts), b2s(2)
    x = np.arange(Ls) / Ls
    pos = np.cumsum((1 - x) ** 1.3)
    i0 = pos.astype(int)
    fr = (pos - i0)[:, None]
    src = music[s0:s0 + Ls + 2]
    music[s0:s0 + Ls] = (src[i0] * (1 - fr) + src[i0 + 1] * fr) * (1 - x ** 3)[:, None]
    gap0, gap1 = s0 + Ls, b2s(ts + 4)
    keep = drums[gap0:gap1].copy()                                             # שתי המחיאות שמחזירות את הגרוב נשארות
    music[gap0:gap1] = 0
    music[b2s(ts + 3.4):gap1] += keep[b2s(ts + 3.4) - gap0:]
    fin = int(0.02 * SR)
    music[gap1:gap1 + fin] *= np.linspace(0, 1, fin)[:, None]

# המוזיקה יורדת מעט מתחת לאפקטים של המוות והסירנה
duck = np.ones(N)
def dip(b_from, b_to, v):
    a, b, e = b2s(b_from), b2s(b_to), int(0.03 * SR)
    duck[a:b] = v
    duck[a - e:a] = np.linspace(1, v, e); duck[b:b + e] = np.linspace(v, 1, e)
for c in cues:
    if c['type'] == 'death':
        dip(c['beat'], c['beat'] + 2.5, 0.6)
    if c['type'] == 'siren':
        dip(c['beat'], c['beat'] + c.get('beats', 4) - 0.5, 0.68)

mix = music * duck[:, None] + sfx + reverb(sfx_wet, 2.2, 11) * 0.9

# דעיכה לשקט מוחלט בסוף
tail = np.ones(N)
a, b = b2s(90), N - int(0.3 * SR)
tail[a:b] = 0.5 * (1 + np.cos(np.linspace(0, np.pi, b - a)))
tail[b:] = 0

# איזון כללי: פחות סאב, יותר נוכחות וברק (כדי שיישמע טוב גם ברמקול של טלפון)
def tilt(x):
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = 1 / np.sqrt(1 + (30 / np.maximum(f, 1e-6)) ** 4)                      # חיתוך מתחת ל-30 הרץ
    g *= 10 ** (-2.5 / 20 / (1 + (f / 70) ** 2))                               # מדף יורד בסאב
    g *= 10 ** (4.0 / 20 * (f ** 2 / (f ** 2 + 2200 ** 2)))                    # מדף עולה מעל ~2.2 קילוהרץ
    return np.fft.irfft(np.fft.rfft(x) * g, n)
mix = np.stack([tilt(mix[:, 0]), tilt(mix[:, 1])], 1)
mix *= tail[:, None]

# הגבלה רכה ונרמול (משאירים מרווח; ההרכבה מנרמלת לעוצמה של -14 LUFS)
ref = np.percentile(np.abs(mix), 99.9)
mix = np.tanh(mix * (0.75 / ref) * 1.05) / 1.05
mix *= 10 ** (-1.5 / 20) / np.max(np.abs(mix))

out = os.path.join(HERE, '..', 'work', 'audio', 'master.wav')
os.makedirs(os.path.dirname(out), exist_ok=True)
pcm = np.round(mix * 32767).astype('<i2')
assert pcm.shape == (N, 2)
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', os.path.normpath(out), pcm.shape[0], 'samples', pcm.shape[0] / SR, 's',
      'peak %.2f dBFS' % (20 * np.log10(np.max(np.abs(mix)))), 'rms %.1f dBFS' % (10 * np.log10(np.mean(mix ** 2))))
