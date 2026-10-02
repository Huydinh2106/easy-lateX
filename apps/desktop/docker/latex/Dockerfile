# Full TeX Live snapshot for both linux/amd64 and linux/arm64. The manifest
# digest makes rebuilds reproducible even if the dated registry tag changes.
FROM danteev/texlive:2026-09-15@sha256:84252e521807fe0cd0e9f4b626834f1e335cda0097d2e01c877d4fee7e519836

LABEL org.opencontainers.image.title="Easy LaTeX development compiler" \
      org.opencontainers.image.version="2026.09.15" \
      org.opencontainers.image.description="Pinned full TeX Live runtime; packages are never installed per project"

ENV HOME=/tmp
WORKDIR /workspace

ENTRYPOINT ["latexmk"]
