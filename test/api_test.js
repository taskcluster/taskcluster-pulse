const assert = require('assert');
const taskcluster = require('taskcluster-client');
const helper = require('./helper');
const load = require('../src/main');
const slugid = require('slugid');
const _ = require('lodash');

helper.secrets.mockSuite('API', ['taskcluster'], function(mock, skipping) {
  helper.withRabbitMq(mock, skipping);
  helper.withEntities(mock, skipping);
  helper.withServer(mock, skipping);

  test('overview runs without error', async function() {
    await helper.client().overview();
  });

  test('ping', async function() {
    await helper.client().ping();
  });

  suite('claimNamespace', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('success', async function() {
      const res = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      assert.equal(res.namespace, 'tcpulse-test-sample');
      // check that the connection string is in the proper vhost
      assert(res.connectionString.endsWith(encodeURIComponent('/test')));
    });

    test('success, no contact', () => {
      return helper.client().claimNamespace('tcpulse-test-sample', {
        expires: taskcluster.fromNow('1 day'),
      });
    });

    test('success, no expires', () => {
      return helper.client().claimNamespace('tcpulse-test-sample', {
        contact: 'a@a.com',
      });
    });

    test('success, no payload keys', () => {
      return helper.client().claimNamespace('tcpulse-test-sample', {
      });
    });

    test('char limit under', () => {
      return helper.client().claimNamespace('tcpulse-test-sampole', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
    });

    test('char limit over', () => {
      const longname = 'tcpulse-test-samplenamespacesamplenamespacesamplenamespacesamplenamespace';
      return helper.client().claimNamespace(longname, {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      }).then(function() {
        assert(false, 'This shouldn\'t have worked');
      }, function(err) {
        assert(err.statusCode === 400, 'Should have returned 400');
      });
    });

    test('char invalid symbols', () => {
      return helper.client().claimNamespace('tcpulse-test-%', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      }).then(function() {
        assert(false, 'This shouldn\'t have worked');
      }, function(err) {
        assert(err.statusCode === 400, 'Should have returned 400');
      });
    });

    test('idempotency - return same namespace', async () => {
      let expires = taskcluster.fromNow('1 day');
      let a = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'a@a.com',
      });
      let b = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'a@a.com',
      });
      assert(_.isEqual(a, b));
    });

    test('update expires', async () => {
      let expires = taskcluster.fromNow('1 day');
      let a = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'a@a.com',
      });
      assert(_.isEqual(new Date(a.expires), expires));

      expires = taskcluster.fromNow('2 days');
      let b = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'a@a.com',
      });
      assert(_.isEqual(new Date(b.expires), expires));
    });

    test('update contact', async () => {
      let expires = taskcluster.fromNow('1 day');
      let a = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'a@a.com',
      });

      let b = await helper.client().claimNamespace('tcpulse-test-sample', {
        expires,
        contact: 'newperson@a.com',
      });
      assert(b.contact === 'newperson@a.com');
    });

    test('entry creation', async () => {
      for (let i = 0; i < 10; i++) {
        await helper.client().claimNamespace('tcpulse-test-sample', {
          expires: taskcluster.fromNow('1 day'),
          contact: 'a@a.com',
        });
      }
      let count = 0;
      await helper.Namespace.scan({},
        {
          limit:            250,
          handler:          ns => count++,
        });
      assert.equal(count, 1);
    });
  });

  suite('namespace', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('returns namespace', async () => {
      await helper.client().claimNamespace('tcpulse-test-sample', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });

      let res = await helper.client().namespace('tcpulse-test-sample');
      assert.equal(res.namespace, 'tcpulse-test-sample');
    });
  });

  suite('listNamespaces', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('returns namespaces', async () => {
      // create a bunch of namespaces
      await Promise.all(['foo', 'bar', 'bing', 'baz'].map(n =>
        helper.client().claimNamespace(`tcpulse-test-${n}`, {
          expires: taskcluster.fromNow('1 day'),
          contact: 'a@a.com',
        })));

      // check that continuation tokens work correctly by getting two batches of two
      // and ensuring all four namespaces are represented (even thought he order is
      // not deterministic)
      let seen = new Set();
      let res = await helper.client().listNamespaces({limit: 2});
      assert.equal(res.namespaces.length, 2);
      res.namespaces.forEach(ns => seen.add(ns.namespace));
      res = await helper.client().listNamespaces({limit: 2, continuationToken: res.continuationToken});
      assert.equal(res.namespaces.length, 2);
      res.namespaces.forEach(ns => seen.add(ns.namespace));
      assert.equal(seen.size, 4);
    });
  });
});
