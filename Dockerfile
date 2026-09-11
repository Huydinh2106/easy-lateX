ARG CODE_SERVER_VERSION=4.135.0
FROM codercom/code-server:${CODE_SERVER_VERSION}-bookworm

LABEL org.opencontainers.image.title="Easy LaTeX workspace" \
      org.opencontainers.image.description="Project-isolated code-server workspace with TeX Live, latexmk, Git, and LaTeX Workshop"

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git \
        latexmk \
        texlive-fonts-recommended \
        texlive-latex-base \
        texlive-latex-extra \
        texlive-latex-recommended \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 config/init-project.sh /usr/local/bin/init-latex-project
COPY --chown=coder:coder project-template/ /opt/project-template/

USER coder

ARG LATEX_WORKSHOP_VERSION=10.18.0

# Open VSX uses the publisher/name pair from the extension manifest. Keep this
# best-effort so a temporary registry outage does not make the TeX image unusable.
RUN if code-server --install-extension "James-Yu.latex-workshop@${LATEX_WORKSHOP_VERSION}" --force \
        && code-server --list-extensions --show-versions \
            | grep -Fqi "james-yu.latex-workshop@${LATEX_WORKSHOP_VERSION}"; then \
        echo "Installed James-Yu.latex-workshop@${LATEX_WORKSHOP_VERSION}"; \
    else \
        echo >&2 "WARNING: LaTeX Workshop could not be installed from Open VSX. See README.md for manual installation steps."; \
    fi

RUN mkdir -p /home/coder/.local/share/code-server/User
COPY --chown=coder:coder config/settings.json /home/coder/.local/share/code-server/User/settings.json

ENV SHELL=/bin/bash

WORKDIR /home/coder/project

# Replace the upstream image's fixed workspace argument so this project's
# workspace is opened explicitly while retaining its fixuid/dumb-init wrapper.
ENTRYPOINT ["/usr/bin/entrypoint.sh"]
CMD ["--bind-addr", "0.0.0.0:8080", "--auth", "password", "--disable-telemetry", "/home/coder/project"]

HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=8 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/healthz || exit 1
