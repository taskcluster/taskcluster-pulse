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

  suite('namespace', function() {
    test('returns a namespace', async () => {
      const namespace = 'tcpulse-test-foobar';
      const namespaceInfo = {
        contact: {
          method: 'irc',
          payload: {channel: '#test'},
        },
      };
      await helper.pulse.claimNamespace(namespace, namespaceInfo);
      await helper.pulse.namespace(namespace);
    });

    test('namespaceNotFound', async () => {
      const namespace = 'tcpulse-test-foobar';
      try {
        await helper.pulse.namespace(namespace);
        assert(false, 'Should have thrown a 404 error.');
      } catch (error) {
        assert(error.statusCode === 404);
      }
    });

    test('invalidNamespace', async () => {
      const namespace = 'tcpulse-test-%';
      try {
        await helper.pulse.namespace(namespace);
        assert(false, 'Should have thrown a 400 error.');
      } catch (error) {
        assert(error.statusCode === 400);
      }
    });

    test('bad namespace prefix', async () => {
      const namespace = 'you-cant-write-that-here';
      try {
        await helper.pulse.namespace(namespace);
        assert(false, 'Should have thrown a 400 error.');
      } catch (error) {
        assert(error.statusCode === 400);
      }
    });
  });

});
