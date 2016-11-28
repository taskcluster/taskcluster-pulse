#!/bin/bash

# Install required system packages:
# python & build-essential by some npm packages, libssl-dev by nvm
apt-get -q update
apt-get -qy upgrade
apt-get -qy install python build-essential libssl-dev rabbitmq-server

# Install the latest LTS node (and npm) via nvm.
# Run commands in a LOGIN shell (note the '-') to ensure correct envs and working dir.
su - ubuntu -- <<"EOF"
curl -so- https://raw.githubusercontent.com/creationix/nvm/v0.32.1/install.sh | bash
# Activate nvm now.
. ~/.nvm/nvm.sh
nvm install --lts
nvm alias default node
EOF

# Enable rabbitmq-management plugin.
rabbitmq-plugins enable rabbitmq_management
service rabbitmq-server restart
