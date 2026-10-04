"""Генерирует tokens.css из tokens.json дизайн-системы «Taimen Console».

Запуск: python3 design-system/gen_tokens.py
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
t = json.loads((HERE / "tokens.json").read_text())


def value(x):
    if isinstance(x, str):
        m = re.fullmatch(r"\{([A-Za-z0-9_.-]+)\}", x)
        return f"var(--{m.group(1)})" if m else x
    return str(x)


out = ["/* Сгенерировано design-system/gen_tokens.py из tokens.json. Не править руками. */"]
for f in t["type"]["fonts"]:
    name = f["file"].split("/")[-1]
    out.append(
        f'@font-face{{font-family:"{f["family"]}";src:url("fonts/{name}") format("truetype");'
        f'font-weight:{f["weight"]};font-style:{f.get("style", "normal")};font-display:swap}}'
    )
light, dark = [], []
for tok in t["color"]["tokens"]:
    v = tok["value"]
    if isinstance(v, dict):
        light.append(f"--{tok['name']}:{value(v['light'])};")
        if "dark" in v:
            dark.append(f"--{tok['name']}:{value(v['dark'])};")
    else:
        light.append(f"--{tok['name']}:{value(v)};")
for fam in ["spacing", "radius", "density", "zIndex", "layout", "shadow"]:
    for tok in t[fam]["tokens"]:
        v = tok["value"]
        if isinstance(v, dict):
            light.append(f"--{tok['name']}:{v['light']};")
            dark.append(f"--{tok['name']}:{v['dark']};")
        else:
            light.append(f"--{tok['name']}:{v};")
for k, v in t["type"]["families"].items():
    light.append(f"--font-{k}:{v};")
d = "".join(dark)
out.append(":root{color-scheme:light;" + "".join(light) + "}")
out.append(f'@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{color-scheme:dark;{d}}}}}')
out.append(f'[data-theme="dark"]{{color-scheme:dark;{d}}}')
(HERE / "tokens.css").write_text("\n".join(out) + "\n")
