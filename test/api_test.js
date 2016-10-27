suite('API', () => {
  let assert = require('assert');
  let taskcluster = require('taskcluster-client');
  let helper = require('./helper');
  let slugid = require('slugid');
  let _           = require('lodash');
  
  test('ping', () => {
    return helper.pulse.ping();
  });

  test('overview', () => {
    return helper.pulse.overview();
  });

  test('exchanges', () => {
    return helper.pulse.exchanges();
  });
  
  test('namespace', () => {
    return helper.pulse.namespace('samplenamespace', {
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    });
  });

  test('namespace - char limit under', () => {
    return helper.pulse.namespace('samplenamespace', {
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    });
  });

  test('namespace - char limit over', () => {
    return helper.pulse.namespace('samplenamespacesamplenamespacesamplenamespacesamplenamespacesamplenamespace', {
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    }).then(function() {
      assert(false, 'This shouldn\'t have worked');
    }, function(err) {
      assert(err.statusCode === 400, 'Should have returned 400');
    });
  });

  test('namespace - char invalid symbols', () => {
    return helper.pulse.namespace('sample%namespace', {
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    }).then(function() {
      assert(false, 'This shouldn\'t have worked');
    }, function(err) {
      assert(err.statusCode === 400, 'Should have returned 400');
    });
  });

  /////////////////////todo: use continuation tokens for all namespace scan methods
  test('expire namespace - no entries', async () => {
    await helper.Namespaces.expire(taskcluster.fromNow('0 hours'));

    var count = 0;
    await helper.Namespaces.scan({}, 
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });
    
    assert(count===0, 'expired namespace not removed');
  });

  test('expire namespace - one entry', async () => {
    await helper.Namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await helper.Namespaces.expire(taskcluster.fromNow('0 hours'));

    var count = 0;
    await helper.Namespaces.scan({}, 
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });
    
    assert(count===0, 'expired namespace not removed');
  });

  test('expire namespace - two entries', async () => {
    await helper.Namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await helper.Namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await helper.Namespaces.expire(taskcluster.fromNow('0 hours'));

    var count = 0;
    await helper.Namespaces.scan({}, 
      {
        limit:            250, // max number of concurrent delete operations
        handler:          (ns) => {
          count++;
        },
      });
    
    assert(count===0, 'expired namespaces not removed');
  });

  test('expire namespace - one of two entries', async () => {
    await helper.Namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
      contact:  {},
    });

    await helper.Namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('1 day'),
      contact:  {},
    });

    await helper.Namespaces.expire(taskcluster.fromNow('0 hours'));

    let count = 0;
    let name = '';
    await helper.Namespaces.scan({}, 
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
    let a = await helper.pulse.namespace('testname', { 
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    });
    let b = await helper.pulse.namespace('testname', {
      contact: {
        method: 'irc',
        id:     'ircusername',
      },
    });
    assert(_.isEqual(a, b)); 
  });
  
  test('"namespace" idempotency - entry creation', async () => {
    for (let i = 0; i < 10; i++) {
      await helper.pulse.namespace('testname', {
        contact: {
          method: 'irc',
          id:     'ircusername',
        },	
      });
    } 
    let count = 0;
    await helper.Namespaces.scan({}, 
      {
        limit:            250, 
        handler:          ns => count++,
      });
    assert.equal(count, 1);
  });
});
