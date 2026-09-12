"""Own decoder (not the upload's): cue the dynock output and require the
formula, under %spot hints only, to be the constant [1 24]."""
import sys
raw = open(sys.argv[1], "rb").read()
bits = int.from_bytes(raw, "little"); pos = 0; refs = {}
def read(n):
    global pos
    v = (bits >> pos) & ((1 << n) - 1); pos += n
    if pos > len(raw) * 8: raise SystemExit("truncated")
    return v
def rub():
    w = 0
    while read(1) == 0: w += 1
    if w == 0: return 0
    return read((1 << (w - 1)) | read(w - 1))
def noun():
    start = pos
    if read(1) == 0: r = rub()
    elif read(1) == 0: r = (noun(), noun())
    else: return refs[rub()]
    refs[start] = r; return r
n = noun()
print("bytes", len(raw))
assert len(raw) <= 4096, "large artifact: evaluation deferred, not a pass"
assert n[0] == int.from_bytes(b"noun", "little") and n[1][1] == 0 and n[1][0][0] == 1, "unexpected envelope"
f = n[1][0][1]
while isinstance(f, tuple) and f[0] == 11:
    hint, f = f[1]
    assert hint[0] == int.from_bytes(b"spot", "little") and hint[1][0] == 1, "unexpected hint"
print("formula", f)
assert f == (1, 24), "not [1 24]"
print("PASS: the 24 assertions evaluated to true (constant 24 emitted)")
