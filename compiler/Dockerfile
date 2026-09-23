FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive SOURCE_DATE_EPOCH=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      biber latexmk texlive-bibtex-extra texlive-fonts-recommended \
      texlive-latex-base texlive-latex-extra texlive-latex-recommended \
      texlive-pictures texlive-science \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 compiler \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin compiler

USER compiler
WORKDIR /workspace
ENTRYPOINT []
CMD ["latexmk", "--version"]
