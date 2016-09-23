Taskcluster Pulse Management Service
====================================

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-pulse.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-pulse)
[![License](https://img.shields.io/badge/license-MPL%202.0-orange.svg)](http://mozilla.org/MPL/2.0)

A service to manage Pulse credentials for anything using
Taskcluster credentials. This allows us self-service and
greater control within the Taskcluster project.

Usage
-----

Write this later.

Options and Defaults
--------------------

Write this later.

Testing
-------

Steps before running the test:

1. Install rabbitmq locally:
   * macOS: `brew update && brew install rabbitmq`
   * Linux: install rabbitmq from the repository of your distribution
2. Start rabbitmq: `rabbitmq-server`.
3. Enable management API: `rabbitmq-plugins enable rabbitmq_management`
4. Create a `user-config.yml`: copy over `user-config-example.yml` (it has the default
   user, password and port of rabbitmq filled in).
5. `npm install`

To run the test, use `npm test`. You can set `DEBUG=taskcluster-pulse,test` if you want to
see what's going on.

After each test, flush rabbitmq database with `rabbitmqctl reset`. (The test suite adds
and removes users during the test. Flushing the database ensures nothing is leaked between
tests.)

## Post-Deployment Verification

We need to figure this out before this is turned on for real.
