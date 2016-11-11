suite('Rabbit Alerter', () => {
  const assert = require('assert');
  const sinon = require('sinon');
  const _ = require('lodash');
  const helper = require('./helper');
  const RabbitMonitor = require('../lib/rabbitmonitor');

  const queueOne = 'one';
  const queueTwo = 'two';
  const taskClusterQueueOne = 'taskcluster/one';
  const taskClusterQueueTwo = 'taskcluster/two';

  const createStats = () => {
    const queueName = taskClusterQueueOne;
    const messages = 0;
    const rate = 0;
    return new RabbitMonitor.Stats(queueName, messages, rate);
  };

  const createEmptyNamespaceResponse = () => {
    return {
      contact: {
        method: '',
        payload: { },
      },
    };
  };

  test('messagesExceeded', () => {
    const stats = createStats();

    stats.messages = 20;
    assert(helper.alerter.messagesExceeded(stats));

    stats.messages = 10;
    assert(!helper.alerter.messagesExceeded(stats));
  });

  test('messagePublishRateExceeded', () => {
    const stats = createStats();

    stats.rate = 20;
    assert(helper.alerter.messagePublishRateExceeded(stats));

    stats.rate = 0;
    assert(!helper.alerter.messagePublishRateExceeded(stats));
  });

  test('createPulseAlert', () => {
    const stats = createStats();
    const namespaceResponse = createEmptyNamespaceResponse();

    namespaceResponse.contact.method = 'pulse';
    namespaceResponse.contact.payload.routingKey = 'rabbit-alerter-test';

    const pulseAlert = helper.alerter.createAlert(stats, namespaceResponse);
    assert(_.has(pulseAlert, 'payload'));
    assert(_.has(pulseAlert.payload, 'routingKey'));
    assert(_.has(pulseAlert.payload, 'message'));
  });

  test('createEmailAlert', () => {
    const stats = createStats();
    const namespaceResponse = createEmptyNamespaceResponse();

    namespaceResponse.contact.method = 'email';
    namespaceResponse.contact.payload.address = 'alert@pulsetests.com';

    const emailAlert = helper.alerter.createAlert(stats, namespaceResponse);
    assert(_.has(emailAlert, 'payload'));
    assert(_.has(emailAlert.payload, 'address'));
    assert(_.has(emailAlert.payload, 'subject'));
    assert(_.has(emailAlert.payload, 'content'));
    assert(!_.has(emailAlert.payload, 'message'));
  });

  test('createIRCAlert', () => {
    const stats = createStats();
    const namespaceResponse = createEmptyNamespaceResponse();

    namespaceResponse.contact.method = 'irc';
    namespaceResponse.contact.payload.channel = '#taskcluster-test';

    const pulseAlert = helper.alerter.createAlert(stats, namespaceResponse);
    assert(_.has(pulseAlert, 'payload'));
    assert(_.has(pulseAlert.payload, 'channel'));
    assert(_.has(pulseAlert.payload, 'message'));
  });

  test('sendAlert', async () => {
    const mockNotifier = {
      pulse: sinon.spy(),
      email: sinon.spy(),
      irc: sinon.spy(),
    };
    helper.alerter.notifier = mockNotifier;

    const stats = createStats();
    const namespaceResponse = createEmptyNamespaceResponse();

    namespaceResponse.contact.method = 'pulse';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(!mockNotifier.pulse.called);

    namespaceResponse.contact.method = 'email';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(!mockNotifier.email.called);

    namespaceResponse.contact.method = 'irc';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(!mockNotifier.irc.called);

    // This should exceed at leat one of the tolerances,
    // giving the alerter a better purpose to deliver alerts.
    stats.messages = 100;
    namespaceResponse.contact.method = 'pulse';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(mockNotifier.pulse.calledOnce);

    namespaceResponse.contact.method = 'email';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(mockNotifier.email.calledOnce);

    namespaceResponse.contact.method = 'irc';
    helper.alerter.sendAlert(stats, namespaceResponse);
    assert(mockNotifier.irc.calledOnce);
  });
});
