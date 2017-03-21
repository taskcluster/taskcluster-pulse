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

  test('namespace - email', () => {
    return helper.pulse.createNamespace('tcpulse-test-sample', {
      contact: {
        method: 'email',
        payload: {address: 'a@a.com'},
      },
    });
  });

  test('namespace - irc(user)', () => {
    return helper.pulse.createNamespace('tcpulse-test-sample', {
      contact: {
        method: 'irc',
        payload: {user: 'test'},
      },
    });
  });

  test('namespace - irc(channel)', () => {
    return helper.pulse.createNamespace('tcpulse-test-sample', {
      contact: {
        method: 'irc',
        payload: {channel: '#test'},
      },
    });
  });

  test('namespace', async () => {
    const namespace = 'tcpulse-test-foobar';
    const namespaceInfo = {
      contact: {
        method: 'irc',
        payload: {channel: '#test'},
      },
    };
    await helper.pulse.createNamespace(namespace, namespaceInfo);
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

  test('createNamespace - char limit under', () => {
    return helper.pulse.createNamespace('tcpulse-test-sampole', {
      contact: {
        method: 'email',
        payload: {address: 'a@a.com'},
      },
    });
  });

  test('createNamespace - char limit over', () => {
    return helper.pulse.createNamespace('tcpulse-test-samplenamespacesamplenamespacesamplenamespacesamplenamespace', {
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

  test('createNamespace - char invalid symbols', () => {
    return helper.pulse.createNamespace('tcpulse-test-%', {
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

  /////////////////////todo: use continuation tokens for all namespace scan methods
  test('expire namespace - no entries', async () => {
    await namespaces.expire(taskcluster.fromNow('0 hours'));

    let count = 0;
    await namespaces.scan({},
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });

    assert(count===0, 'expired namespace not removed');
  });

  test('expire namespace - one entry', async () => {
    await namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      rotationState: '1',
      nextRotation:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await namespaces.expire(taskcluster.fromNow('0 hours'));

    let count = 0;
    await namespaces.scan({},
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });

    assert(count===0, 'expired namespace not removed');
  });

  test('expire namespace - two entries', async () => {
    await namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      rotationState: '1',
      nextRotation:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      rotationState: '1',
      nextRotation:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await namespaces.expire(taskcluster.fromNow('0 hours'));

    let count = 0;
    await namespaces.scan({},
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });

    assert(count===0, 'expired namespaces not removed');
  });

  test('expire namespace - one of two entries', async () => {
    await namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      rotationState: '1',
      nextRotation:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('1 day'),
      rotationState: '1',
      nextRotation:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await namespaces.expire(taskcluster.fromNow('0 hours'));

    let count = 0;
    let name = '';
    await namespaces.scan({},
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          name=ns.namespace;
          count++;
        },
      });

    assert(count===1, 'one namespace should still be active');
    assert(name==='e2', 'wrong namespace removed');
  });

  test('"namespace" idempotency - return same namespace', async () => {
    let a = await helper.pulse.createNamespace('tcpulse-test-sample', {
      contact: {
        method: 'email',
        payload: {address: 'a@a.com'},
      },
    });
    let b = await helper.pulse.createNamespace('tcpulse-test-sample', {
      contact: {
        method: 'email',
        payload: {address: 'a@a.com'},
      },
    });
    assert(_.isEqual(a, b));
  });

  test('"namespace" idempotency - entry creation', async () => {
    for (let i = 0; i < 10; i++) {
      await helper.pulse.createNamespace('tcpulse-test-sample', {
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

  suite('rotate namespace', function() {
    if (!helper.haveRabbitMq) {
      this.pending = true;
    }

    test('rotate namespace - no entries', async () => {
      await namespaces.rotate(taskcluster.fromNow('0 hours'), helper.rabbit);

      let count = 0;
      await namespaces.scan({},
        {
          limit:            250,
          handler:          (ns) => {
            count++;
          },
        });

      assert(count===0, 'no entries should exist');
    });

    test('rotate namespace - one entry', async () => {
      var old_pass = slugid.v4();

      await namespaces.create({
        namespace: 'tcpulse-test-sample',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await namespaces.rotate(taskcluster.fromNow('0 hours'), helper.rabbit);

      var ns = await namespaces.load({namespace: 'tcpulse-test-sample'});
      assert(ns, 'namespace should exist');
      assert(ns.rotationState==='2', 'namespace should have rotated state');
      assert(ns.password !== old_pass, 'rotated namespace should have new password');

    });

    test('rotate namespace - two entry', async () => {
      var old_pass = slugid.v4();

      await namespaces.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await namespaces.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await namespaces.rotate(taskcluster.fromNow('0 hours'), helper.rabbit);

      var ns1 = await namespaces.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await namespaces.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState==='1', 'tcpulse-test-sample2 should have rotated state');
      assert(ns2.password !== old_pass, 'rotated tcpulse-test-sample2 should have new password');

    });

    test('rotate namespace - one of two entry', async () => {
      var old_pass = slugid.v4();

      await namespaces.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await namespaces.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('1 day'),
        contact:  {},
      });

      await namespaces.rotate(taskcluster.fromNow('0 hours'), helper.rabbit);

      var ns1 = await namespaces.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await namespaces.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState ==='2', 'tcpulse-test-sample2 should have same rotation state');
      assert(ns2.password === old_pass, 'tcpulse-test-sample2 should have same password');
    });
  });
});
