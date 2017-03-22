suite('API', () => {
  let assert = require('assert');
  let taskcluster = require('taskcluster-client');
  let helper = require('./helper');
  let load = require('../lib/main');
  let slugid = require('slugid');
  let _ = require('lodash');

  let namespaces;

  setup(async () => {
    //set up the namespace entities
    namespaces = await load('Namespaces', {profile: 'test', process: 'test'});

    //ensureTable actually instantiates the table if non-existing. Supposed to be idempotent, but not
    await namespaces.ensureTable();
  });

  teardown(async () => {
    //remove the namespace entities
    await namespaces.removeTable();
  });

  test('ping', () => {
    return helper.pulse.ping();
  });

  test('overview', helper.requiresRabbitMq(() => {
    return helper.pulse.overview();
  }));

  test('exchanges', helper.requiresRabbitMq(() => {
    return helper.pulse.exchanges();
  }));

  suite('claimNamespace', function() {
    test('email', () => {
      return helper.pulse.claimNamespace('tcpulse-test-sample', {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      });
    });

    test('irc(user)', () => {
      return helper.pulse.claimNamespace('tcpulse-test-sample', {
        contact: {
          method: 'irc',
          payload: {user: 'test'},
        },
      });
    });

    test('irc(channel)', () => {
      return helper.pulse.claimNamespace('tcpulse-test-sample', {
        contact: {
          method: 'irc',
          payload: {channel: '#test'},
        },
      });
    });

    test('char limit under', () => {
      return helper.pulse.claimNamespace('tcpulse-test-sampole', {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      });
    });

    test('char limit over', () => {
      const longname = 'tcpulse-test-samplenamespacesamplenamespacesamplenamespacesamplenamespace';
      return helper.pulse.claimNamespace(longname, {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      }).then(function() {
        assert(false, 'This shouldn\'t have worked');
      }, function(err) {
        assert(err.statusCode === 400, 'Should have returned 400');
      });
    });

    test('char invalid symbols', () => {
      return helper.pulse.claimNamespace('tcpulse-test-%', {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      }).then(function() {
        assert(false, 'This shouldn\'t have worked');
      }, function(err) {
        assert(err.statusCode === 400, 'Should have returned 400');
      });
    });

    test('idempotency - return same namespace', async () => {
      let a = await helper.pulse.claimNamespace('tcpulse-test-sample', {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      });
      let b = await helper.pulse.claimNamespace('tcpulse-test-sample', {
        contact: {
          method: 'email',
          payload: {address: 'a@a.com'},
        },
      });
      assert(_.isEqual(a, b));
    });

    test('entry creation', async () => {
      for (let i = 0; i < 10; i++) {
        await helper.pulse.claimNamespace('tcpulse-test-sample', {
          contact: {
            method: 'email',
            payload: {address: 'a@a.com'},
          },
        });
      }
      let count = 0;
      await namespaces.scan({},
        {
          limit:            250,
          handler:          ns => count++,
        });
      assert.equal(count, 1);
    });
  });

  suite('listNamespaces', function() {
    test('returns namespaces', async () => {
      // create a bunch of namespaces
      await Promise.all(['foo', 'bar', 'bing', 'baz'].map(n => 
        helper.pulse.claimNamespace(`tcpulse-test-${n}`, {
          contact: {
            method: 'irc',
            payload: {channel: `#${n}`},
          },
        })));

      // check that continuation tokens work correctly by getting two batches of two
      // and ensuring all four namespaces are represented (even thought he order is
      // not deterministic)
      let seen = new Set();
      let res = await helper.pulse.listNamespaces({limit: 2});
      assert.equal(res.namespaces.length, 2);
      res.namespaces.forEach(ns => seen.add(ns.namespace));
      res = await helper.pulse.listNamespaces({limit: 2, continuation: res.continuationToken});
      assert.equal(res.namespaces.length, 2);
      res.namespaces.forEach(ns => seen.add(ns.namespace));
      assert.equal(seen.size, 4);
    });
  });
});
