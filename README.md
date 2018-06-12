Taskcluster Pulse Management Service
====================================

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-pulse.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-pulse)
[![License](https://img.shields.io/badge/license-MPL%202.0-orange.svg)](http://mozilla.org/MPL/2.0)

A service to manage Pulse credentials for anything using Taskcluster
credentials. This allows us self-service and greater control within the
Taskcluster project.

Operation
---------

Services using pulse credentials call this service's `claimNamespace` endpoint
to claim a "namespace" in pulse, allowing access to exchanges and queues based
on that namespace.

The  service must call the endpoint periodically, each time getting a fresh
username and password to access pulse.  Access is checked each time using
Taskcluster credentials.

The service monitors the existing credentials:

* rotating the password on unclaimed credentials
* notifying owners of, and eventually deleting queues which grow too large
* deleting queues and exchanges when the corresponding namespace expires

Status
------

This service is not in production yet.

It does not yet connect to pulse, and the queue monitoring mentioned above is
not yet complete.

Compatibility
-------------

This service works with RabbitMQ 3.6.x.
Later versions come with changes to the management interface that are not yet supported.

Testing
-------

Steps before running the test:

1. Run rabbitmq: `docker run -ti --rm --env RABBITMQ_DEFAULT_VHOST=/test -p 15672:15672 -p 5672:5672 rabbitmq:3.6-management-alpine`.  You can do this another way if you'd like, but installation, configuration and so on are up to you!
1. Copy `user-config-example.yml` to `user-config.yml` unmodified
1. `yarn install`

To run the test, use `yarn test`. You can set `DEBUG=taskcluster-pulse,test` if you want to
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
