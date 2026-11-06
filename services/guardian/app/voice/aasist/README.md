# AASIST-L (vendored)

Model code (`AASIST.py`), config (`AASIST-L.conf`) and pretrained weights (`weights/AASIST-L.pth`) from
[clovaai/aasist](https://github.com/clovaai/aasist), Copyright (c) 2021-present NAVER Corp., MIT License
(see `LICENSE` and `NOTICE`, kept unmodified). Paper: Jung et al., "AASIST: Audio Anti-Spoofing using
Integrated Spectro-Temporal Graph Attention Networks", ICASSP 2022.

Trained on ASVspoof 2019 LA. Scores on modern TTS/voice clones and real microphones are a weak signal,
so SayItPayIt uses it as one Guardian signal; the random challenge phrase is the hard anti-replay check.
