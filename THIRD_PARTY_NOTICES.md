# Third-party components

The MIT license in `LICENSE` covers the code of this repository only. It does not cover NOWA, which is fetched
separately and stays under its own license (below).

## NOWA-Bio-Inspired-AI — not included

- Source: https://github.com/burlakovmb/NOWA-Bio-Inspired-AI (author: Mikhail Burlakov)
- License: PolyForm Strict 1.0.0 — noncommercial use only; no redistribution, no modification, no derivative
  works without a separate license from the author.
- This repository contains **no NOWA code**. `scripts/setup` clones it from the author's repository into
  `vendor/nowa/` (ignored by git) at the commit pinned in `nowa.lock`. It is used unmodified, through the single
  adapter `nowasea/brains/nowa_adapter.py`.
- Whether a host program like this one is allowed under the author's license is the author's call. Ask the author
  before publishing or distributing builds that include NOWA.

## abyssal-garden — included as a modified fork in `renderer/`

- Source: https://github.com/Noniv/abyssal-garden, commit a596354
- License: MIT — full text in `renderer/LICENSE-abyssal-garden`.

## Python and Node dependencies

numpy (BSD-3-Clause), aiohttp (Apache-2.0), pytest (MIT, development only), esbuild (MIT, build only).
