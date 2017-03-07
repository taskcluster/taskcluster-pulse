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

1. Run rabbitmq.  Either:
    * Install rabbitmq locally:
       * macOS: `brew update && brew install rabbitmq`
       * Linux: install rabbitmq from the repository of your distribution
    * Start rabbitmq: `rabbitmq-server`.
    * Enable management API: `rabbitmq-plugins enable rabbitmq_management`
   or
    * Run `docker run -ti --rm -p 15672:15672 -p 5672:5672 rabbitmq:management-alpine`
1. Copy `user-config-example.yml` to `user-config.yml` unmodified
1. `npm install`

To run the test, use `npm test`. You can set `DEBUG=taskcluster-pulse,test` if you want to
see what's going on.

Note that you can run the tests with no `user-config.yml`, but most are skipped because they
require a RabbitMQ instance.

After each test, flush rabbitmq database with `rabbitmqctl reset` or by
stopping and re-starting the docker container.. (The test suite adds and
removes users during the test. Flushing the database ensures nothing is leaked
between tests.)

## Post-Deployment Verification

We need to figure this out before this is turned on for real.

## Service Owner

Servie Owner: bstack@mozilla.com
