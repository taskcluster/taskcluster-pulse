suite('API', () => {
  let assert = require('assert');
  let taskcluster = require('taskcluster-client');
  let helper = require('./helper');
  let slugid = require('slugid');

  test('ping', () => {
    return helper.pulse.ping();
  });

  test('overview', () => {
    return helper.pulse.overview();
  });
  
  test('namespace', () => {
    return helper.pulse.namespace('samplenamespace', {
      contact: {
        method: 'email',
        payload: {
          address: 'a@a.com',
          subject: 'subject',
          content: 'content',
        },
      },
    });
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

    var count = 0;
    var name = '';
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

});

