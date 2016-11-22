#!/bin/bash

# Latest LTS as of Nov 22, 2016
NODE_VERSION="6.9.1"

# Install new nodejs.
_node_filename="node-v${NODE_VERSION}-linux-x64.tar.xz"
_node_url="https://nodejs.org/dist/v${NODE_VERSION}/${_node_filename}"
cd /usr/local
wget -nv "$_node_url"
mkdir "node-${NODE_VERSION}"
tar xf "${_node_filename}" -C "node-${NODE_VERSION}" --strip-components=1
rm "${_node_filename}"
# Overwrite existing nodejs PATH env.
echo "export PATH=\$PATH:/usr/local/node-${NODE_VERSION}/bin" > /etc/profile.d/nodejs.sh

# Enable rabbitmq-management plugin.
rabbitmq-plugins enable rabbitmq_management
service rabbitmq-server restart
