# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  config.vm.box = "taskcluster-dev-0.2.0"
  config.vm.box_url = "https://s3.amazonaws.com/task-cluster-dev/0.2.0/taskcluster_dev.box"
  config.vm.provision "shell", path: 'vagrant.sh'
end
