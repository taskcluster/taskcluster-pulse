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
  
  /////////////////////use continuation tokens for all namespace scan methods

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

  test('expire namespace - expire two entries', async () => {
    await helper.Namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
    });

    await helper.Namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
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

  test('expire namespace - expire one of two entries', async () => {
    await helper.Namespaces.create({
      namespace: 'e1',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('- 1 day'),
    });

    await helper.Namespaces.create({
      namespace: 'e2',
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('1 day'),
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
    let a = await helper.pulse.namespace('testname');
    let b = await helper.pulse.namespace('testname');
    assert(_.isEqual(a, b)); 
  });
  
  test('"namespace" idempotency - entry creation', async () => {
    for (let i = 0; i < 10; i++) {
      await helper.pulse.namespace('testname');
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
