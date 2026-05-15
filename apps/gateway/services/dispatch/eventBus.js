"use strict";

const EventEmitter = require("events");
const taskStore = require("./taskStore");

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

function publish(taskId, evt) {
  const stored = taskStore.appendEvent(taskId, evt);
  emitter.emit(`task:${taskId}`, stored);
  emitter.emit("task:*", stored);
  return stored;
}

function subscribe(taskId, handler) {
  const topic = `task:${taskId}`;
  emitter.on(topic, handler);
  return () => emitter.off(topic, handler);
}

module.exports = { publish, subscribe };
