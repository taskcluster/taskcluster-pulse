let assert = require('assert');
let Entity = require('azure-entities');

/**
 * Entity for keeping track of pulse user credentials
 *
 */
let Namespace = Entity.configure({
  version:          1,
  partitionKey:     Entity.keys.StringKey('namespace'),
  rowKey:           Entity.keys.StringKey('username'),
  properties: {
    namespace:      Entity.types.String,
    username:       Entity.types.String,
    password:       Entity.types.String,
    created:        Entity.types.Date,
    expires:        Entity.types.Date,
  },
});

Namespace.expire = async function(now){
  assert(now instanceof Date, 'now must be given as option');
  var count = 0;
  await Entity.scan.call(this, {
    expires:          Entity.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent delete operations
    handler:          (ns) => {
      count++;
      return ns.remove(true);
    },
  });
  return count;
};

module.exports = {Namespace};

