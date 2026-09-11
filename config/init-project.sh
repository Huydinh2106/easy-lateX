#!/bin/sh
set -eu

target=/home/coder/project
template=/opt/project-template

if [ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo >&2 "Refusing to initialize a non-empty project volume."
    exit 1
fi

cp -a "$template"/. "$target"/
chown -R coder:coder "$target"

# The named volume is mounted as root, while the editor runs as coder. Create
# the repository as that same non-root user so Git ownership checks and future
# commits behave normally inside code-server.
su -s /bin/sh coder -c 'git -C /home/coder/project init --initial-branch=main'
su -s /bin/sh coder -c 'git -C /home/coder/project config user.name "Easy LaTeX"'
su -s /bin/sh coder -c 'git -C /home/coder/project config user.email "easy-latex@localhost"'
su -s /bin/sh coder -c 'git -C /home/coder/project add .'
su -s /bin/sh coder -c 'git -C /home/coder/project commit -m "Initial project"'
