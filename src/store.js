/* eslint-disable no-use-before-define, no-console */
import * as cache from "./cache.js";

/* istanbul ignore next */
try { process.env.NODE_ENV } catch(e) { var process = { env: { NODE_ENV: 'production' } }; } // eslint-disable-line

export const connect = `__store__connect__${Date.now()}__`;
const definitions = new WeakMap();

// UUID v4 generator thanks to https://gist.github.com/jed/982883
function uuid(temp) {
  return temp
    ? // eslint-disable-next-line no-bitwise, no-mixed-operators
      (temp ^ ((Math.random() * 16) >> (temp / 4))).toString(16)
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, uuid);
}

function resolve(config, model, lastModel) {
  if (lastModel) definitions.set(lastModel, null);
  return model;
}

function resolveWithInvalidate(config, model, lastModel) {
  resolve(config, model, lastModel);

  if ((config.external && model) || !lastModel || error(model)) {
    config.invalidate();
  }

  return model;
}

function sync(config, id, model, invalidate) {
  cache.set(
    config,
    id,
    invalidate ? resolveWithInvalidate : resolve,
    model,
    true,
  );
  return model;
}

let currentTimestamp;
function getCurrentTimestamp() {
  if (!currentTimestamp) {
    currentTimestamp = Date.now();
    requestAnimationFrame(() => {
      currentTimestamp = undefined;
    });
  }
  return currentTimestamp;
}

const timestamps = new WeakMap();

function getTimestamp(model) {
  let timestamp = timestamps.get(model);

  if (!timestamp) {
    timestamp = getCurrentTimestamp();
    timestamps.set(model, timestamp);
  }

  return timestamp;
}

function setTimestamp(model) {
  timestamps.set(model, getCurrentTimestamp());
  return model;
}

function setupStorage(storage) {
  if (typeof storage === "function") storage = { get: storage };

  const result = { cache: true, ...storage };

  if (result.cache === false || result.cache === 0) {
    result.validate = cachedModel =>
      !cachedModel || getTimestamp(cachedModel) === getCurrentTimestamp();
  } else if (typeof result.cache === "number") {
    result.validate = cachedModel =>
      !cachedModel ||
      getTimestamp(cachedModel) + result.cache > getCurrentTimestamp();
  } else if (result.cache !== true) {
    throw TypeError(
      `Storage cache property must be a boolean or number: ${typeof result.cache}`,
    );
  }

  return Object.freeze(result);
}

function memoryStorage(config) {
  return {
    get: config.enumerable ? () => {} : () => config.create({}),
    set: config.enumerable
      ? (id, values) => values
      : (id, values) => (values === null ? { id } : values),
    list:
      config.enumerable &&
      function list(id) {
        if (id) {
          throw TypeError(`Memory-based model definition does not support id`);
        }

        return cache.getEntries(config).reduce((acc, { key, value }) => {
          if (key === config) return acc;
          if (value && !error(value)) acc.push(key);
          return acc;
        }, []);
      },
  };
}

function bootstrap(Model, options) {
  if (Array.isArray(Model)) return setupListModel(Model[0], options);
  return setupModel(Model);
}

function getTypeConstructor(type, key) {
  switch (type) {
    case "string":
      return String;
    case "number":
      return Number;
    case "boolean":
      return Boolean;
    default:
      throw TypeError(
        `The value for the '${key}' array must be a string, number or boolean: ${type}`,
      );
  }
}

const stateSetter = (h, v) => v;
function setModelState(model, state, value = model) {
  cache.set(model, "state", stateSetter, { state, value }, true);
  return model;
}

const stateGetter = (model, v = { state: "ready", value: model }) => v;
function getModelState(model) {
  return cache.get(model, "state", stateGetter);
}

const _ = (h, v) => v;

const configs = new WeakMap();
function setupModel(Model) {
  if (typeof Model !== "object" || Model === null) {
    throw TypeError(`Model definition must be an object: ${typeof Model}`);
  }
  let config = configs.get(Model);

  if (!config) {
    const storage = Model[connect];
    if (storage) delete Model[connect];

    let invalidatePromise;
    const placeholder = {};

    config = {
      model: Model,
      external: !!storage,
      enumerable: hasOwnProperty.call(Model, "id"),
      placeholder: id =>
        setModelState(
          Object.freeze(Object.assign(Object.create(placeholder), { id })),
          "pending",
        ),
      invalidate: () => {
        if (!invalidatePromise) {
          invalidatePromise = Promise.resolve().then(() => {
            const entry = cache.getEntry(config, config);
            if (entry.contexts && entry.contexts.size) {
              cache.invalidate(config, config, true);
            }
            invalidatePromise = null;
          });
        }
      },
    };

    config.storage = setupStorage(storage || memoryStorage(config, Model));

    const transform = Object.keys(Object.freeze(Model)).map(key => {
      if (key !== "id") {
        Object.defineProperty(placeholder, key, {
          get() {
            throw Error(
              `Model instance in ${
                getModelState(this).state
              } state - use store.pending(), store.error(), or store.ready() guards`,
            );
          },
          enumerable: true,
        });
      }

      if (key === "id") {
        if (Model[key] !== true) {
          throw TypeError(
            `The 'id' property value must be true or undefined: ${typeof Model[
              key
            ]}`,
          );
        }
        return (model, data, lastModel) => {
          let id;
          if (lastModel) {
            id = lastModel.id;
          } else if (hasOwnProperty.call(data, "id")) {
            id = String(data.id);
          } else {
            id = uuid();
          }

          Object.defineProperty(model, "id", { value: id, enumerable: true });
        };
      }

      const type = typeof Model[key];
      const defaultValue = Model[key];

      switch (type) {
        case "function":
          return model => {
            Object.defineProperty(model, key, {
              get() {
                return cache.get(this, key, defaultValue);
              },
            });
          };
        case "object": {
          if (defaultValue === null) {
            throw TypeError(
              `The value for the '${key}' must be an object instance: ${defaultValue}`,
            );
          }

          const isArray = Array.isArray(defaultValue);

          if (isArray) {
            const nestedType = typeof defaultValue[0];

            if (nestedType !== "object") {
              const Constructor = getTypeConstructor(nestedType, key);
              const defaultArray = Object.freeze(defaultValue.map(Constructor));
              return (model, data, lastModel) => {
                if (hasOwnProperty.call(data, key)) {
                  if (!Array.isArray(data[key])) {
                    throw TypeError(
                      `The value for '${key}' property must be an array: ${typeof data[
                        key
                      ]}`,
                    );
                  }
                  model[key] = Object.freeze(data[key].map(Constructor));
                } else if (lastModel && hasOwnProperty.call(lastModel, key)) {
                  model[key] = lastModel[key];
                } else {
                  model[key] = defaultArray;
                }
              };
            }

            const localConfig = bootstrap(defaultValue, { nested: true });

            if (localConfig.enumerable && defaultValue[1]) {
              const nestedOptions = defaultValue[1];
              if (typeof nestedOptions !== "object") {
                throw TypeError(
                  `Options for '${key}' array property must be an object instance: ${typeof nestedOptions}`,
                );
              }
              if (nestedOptions.loose) {
                config.contexts = config.contexts || new Set();
                config.contexts.add(bootstrap(defaultValue[0]));
              }
            }
            return (model, data, lastModel) => {
              if (hasOwnProperty.call(data, key)) {
                if (!Array.isArray(data[key])) {
                  throw TypeError(
                    `The value for '${key}' property must be an array: ${typeof data[
                      key
                    ]}`,
                  );
                }
                model[key] = localConfig.create(data[key]);
              } else {
                model[key] =
                  (lastModel && lastModel[key]) ||
                  (!localConfig.enumerable &&
                    localConfig.create(defaultValue)) ||
                  [];
              }
            };
          }

          const nestedConfig = bootstrap(defaultValue);
          if (nestedConfig.enumerable || nestedConfig.external) {
            return (model, data, lastModel) => {
              let resultModel;

              if (hasOwnProperty.call(data, key)) {
                const nestedData = data[key];

                if (typeof nestedData !== "object" || nestedData === null) {
                  if (nestedData !== undefined && nestedData !== null) {
                    resultModel = { id: nestedData };
                  }
                } else {
                  const dataConfig = definitions.get(nestedData);
                  if (dataConfig) {
                    if (dataConfig.model !== defaultValue) {
                      throw TypeError(
                        "Model instance must match the definition",
                      );
                    }
                    resultModel = nestedData;
                  } else {
                    resultModel = nestedConfig.create(nestedData);
                    sync(nestedConfig, resultModel.id, resultModel);
                  }
                }
              } else {
                resultModel = lastModel && lastModel[key];
              }

              if (resultModel) {
                const id = resultModel.id;
                Object.defineProperty(model, key, {
                  get() {
                    return cache.get(
                      this,
                      key,
                      pending(this) ? _ : () => get(defaultValue, id),
                    );
                  },
                  enumerable: true,
                });
              } else {
                model[key] = undefined;
              }
            };
          }

          return (model, data, lastModel) => {
            if (hasOwnProperty.call(data, key)) {
              model[key] = nestedConfig.create(
                data[key],
                lastModel && lastModel[key],
              );
            } else {
              model[key] = lastModel ? lastModel[key] : nestedConfig.create({});
            }
          };
        }
        // eslint-disable-next-line no-fallthrough
        default: {
          const Constructor = getTypeConstructor(type);
          return (model, data, lastModel) => {
            if (hasOwnProperty.call(data, key)) {
              model[key] = Constructor(data[key]);
            } else if (lastModel && hasOwnProperty.call(lastModel, key)) {
              model[key] = lastModel[key];
            } else {
              model[key] = defaultValue;
            }
          };
        }
      }
    });

    config.create = function create(data, lastModel) {
      if (data === null) return null;

      if (typeof data !== "object") {
        throw TypeError(`Model values must be an object: ${data}`);
      }

      const model = transform.reduce((acc, fn) => {
        fn(acc, data, lastModel);
        return acc;
      }, {});

      definitions.set(model, config);

      return Object.freeze(model);
    };

    Object.freeze(placeholder);

    configs.set(Model, Object.freeze(config));
  }

  return config;
}

const listPlaceholderPrototype = Object.getOwnPropertyNames(
  Array.prototype,
).reduce((acc, key) => {
  if (key === "length") return acc;

  Object.defineProperty(acc, key, {
    get() {
      throw Error(
        `Model list instance in '${
          getModelState(this).state
        }' state - use store.pending(), store.error(), or store.ready() guards`,
      );
    },
  });
  return acc;
}, []);

const lists = new WeakMap();
function setupListModel(Model, options = { nested: false }) {
  let config = lists.get(Model);

  if (config && config.nested && !options.nested) {
    throw TypeError(
      "Nested list definition cannot be used outside of the primary context",
    );
  }

  if (!config) {
    const modelConfig = setupModel(Model);

    const contexts = new Set();
    contexts.add(modelConfig);

    if (!options.nested) {
      if (!modelConfig.enumerable) {
        throw TypeError(
          "Listing model definition requires 'id' key set to `true`",
        );
      }
      if (!modelConfig.storage.list) {
        throw TypeError("Model definition storage must support `list` action");
      }
    }

    config = {
      list: true,
      nested: !modelConfig.enumerable && options.nested,
      model: Model,
      contexts,
      enumerable: modelConfig.enumerable,
      storage: setupStorage({
        cache: modelConfig.storage.cache,
        get:
          !options.nested &&
          (id => {
            return modelConfig.storage.list(id);
          }),
      }),
      placeholder: () =>
        setModelState(
          Object.freeze(Object.create(listPlaceholderPrototype)),
          "pending",
        ),
      create(items) {
        const result = items.reduce((acc, data) => {
          let id = data;
          if (typeof data === "object" && data !== null) {
            id = data.id;
            const dataConfig = definitions.get(data);
            let model = data;
            if (dataConfig) {
              if (dataConfig.model !== Model) {
                throw TypeError("Model instance must match the definition");
              }
            } else {
              model = modelConfig.create(data);
              if (modelConfig.enumerable) {
                id = model.id;
                sync(modelConfig, id, model);
              }
            }
            if (!modelConfig.enumerable) {
              acc.push(model);
            }
          } else if (!modelConfig.enumerable) {
            throw TypeError(`Model instance must be an object: ${typeof data}`);
          }
          if (modelConfig.enumerable) {
            const key = acc.length;
            Object.defineProperty(acc, key, {
              get() {
                return cache.get(
                  this,
                  key,
                  pending(this) ? _ : () => get(Model, id),
                );
              },
              enumerable: true,
            });
          }
          return acc;
        }, []);

        definitions.set(result, config);

        return Object.freeze(result);
      },
    };

    lists.set(Model, Object.freeze(config));
  }

  return config;
}

function resolveTimestamp(h, v) {
  return v || getCurrentTimestamp();
}

function stringifyId(id) {
  switch (typeof id) {
    case "object":
      return JSON.stringify(
        Object.keys(id)
          .sort()
          .reduce((acc, key) => {
            if (typeof id[key] === "object" && id[key] !== null) {
              throw TypeError(
                `You must use primitive value for '${key}' key: ${typeof id[
                  key
                ]}`,
              );
            }
            acc[key] = id[key];
            return acc;
          }, {}),
      );
    case "undefined":
      return undefined;
    default:
      return String(id);
  }
}

function mapError(model, err, suppressLog) {
  /* istanbul ignore next */
  if (
    process.env.NODE_ENV !== "production" &&
    console.error &&
    suppressLog !== false
  ) {
    console.error(err);
  }

  return setModelState(model, "error", err);
}

function get(Model, id) {
  const config = bootstrap(Model);
  let stringId;

  if (!config.storage.get) {
    throw TypeError("Provided model definition does not support 'get' method");
  }

  if (config.enumerable) {
    stringId = stringifyId(id);

    if (!config.list && !stringId) {
      throw TypeError("Provided model definition requires non-empty id");
    }
  } else if (id !== undefined) {
    throw TypeError("Provided model definition does not support id");
  }

  return cache.get(
    config,
    stringId,
    (h, cachedModel) => {
      if (cachedModel && pending(cachedModel)) return cachedModel;

      let validContexts = true;
      if (config.contexts) {
        config.contexts.forEach(context => {
          if (
            cache.get(context, context, resolveTimestamp) ===
            getCurrentTimestamp()
          ) {
            validContexts = false;
          }
        });
      }

      if (
        validContexts &&
        cachedModel &&
        (config.storage.cache === true || config.storage.validate(cachedModel))
      ) {
        return cachedModel;
      }

      try {
        let result = config.storage.get(id);

        if (typeof result !== "object" || result === null) {
          throw Error(
            `Model instance ${
              stringId !== undefined ? `with '${stringId}' id` : ""
            } does not exist: ${result}`,
          );
        }

        if (result instanceof Promise) {
          result = result
            .then(data => {
              if (typeof data !== "object" || data === null) {
                throw Error(
                  `Model instance ${
                    stringId !== undefined ? `with '${stringId}' id` : ""
                  } does not exist: ${result}`,
                );
              }

              return sync(
                config,
                stringId,
                config.create(stringId ? { id: stringId, ...data } : data),
              );
            })
            .catch(e => {
              return sync(
                config,
                stringId,
                mapError(cachedModel || config.placeholder(stringId), e),
              );
            });

          return setModelState(
            cachedModel || config.placeholder(stringId),
            "pending",
            result,
          );
        }

        if (cachedModel) definitions.set(cachedModel, null);
        return setTimestamp(
          config.create(stringId ? { id: stringId, ...result } : result),
        );
      } catch (e) {
        return setTimestamp(
          mapError(cachedModel || config.placeholder(stringId), e),
        );
      }
    },
    config.storage.validate,
  );
}

function set(model, values = {}) {
  let config = definitions.get(model);
  const isInstance = !!config;

  if (config === null) {
    throw Error(
      "Provided model instance has expired. Haven't you used stale value?",
    );
  }

  if (!config) config = bootstrap(model);

  if (config.list) {
    throw TypeError("Listing model definition does not support 'set' method");
  }

  if (!config.storage.set) {
    throw TypeError(
      "Provided model definition storage does not support 'set' method",
    );
  }

  let id;
  let setState;

  try {
    if (
      config.enumerable &&
      !isInstance &&
      (!values || typeof values !== "object")
    ) {
      throw TypeError(
        `Model values must be taken from an object instance: ${values}`,
      );
    }

    if (values && hasOwnProperty.call(values, "id")) {
      throw TypeError(`Model values must not have 'id' property: ${values.id}`);
    }

    setState = (state, value) => {
      if (isInstance) {
        setModelState(model, state, value);
      } else {
        const entry = cache.getEntry(config, id);
        if (entry.value) {
          setModelState(entry.value, state, value);
        }
      }
    };

    const localModel = config.create(values, isInstance ? model : undefined);
    const keys = values ? Object.keys(values) : [];

    id = localModel ? localModel.id : model.id;

    const result = Promise.resolve(
      config.storage.set(isInstance ? id : undefined, localModel, keys),
    )
      .then(data => {
        const resultModel =
          data === localModel ? localModel : config.create(data);

        if (isInstance && resultModel && id !== resultModel.id) {
          throw TypeError(
            `Local and storage data must have the same id: '${id}', '${resultModel.id}'`,
          );
        }

        const resultId = resultModel ? resultModel.id : id;

        return sync(
          config,
          resultId,
          resultModel ||
            mapError(
              config.placeholder(resultId),
              Error(
                `Model instance ${
                  id !== undefined ? `with '${id}' id` : ""
                } does not exist: ${resultModel}`,
              ),
              false,
            ),
          true,
        );
      })
      .catch(err => {
        err = err !== undefined ? err : Error("Undefined error");
        setState("error", err);
        throw err;
      });

    setState("pending", result);

    return result;
  } catch (e) {
    if (setState) setState("error", e);
    return Promise.reject(e);
  }
}

function clear(model, clearValue = true) {
  if (typeof model !== "object" || model === null) {
    throw TypeError(
      `The first argument must be a model instance or a model definition: ${model}`,
    );
  }

  const config = definitions.get(model);

  if (config === null) {
    throw Error(
      "Provided model instance has expired. Haven't you used stale value from the outer scope?",
    );
  }

  if (config) {
    cache.invalidate(config, model.id, clearValue, true);
  } else {
    if (!configs.get(model) && !lists.get(model[0])) {
      throw Error(
        "Model definition must be used before - passed argument is probably not a model definition",
      );
    }
    cache.invalidateAll(bootstrap(model), clearValue, true);
  }
}

function pending(model) {
  if (model === null || typeof model !== "object") return false;
  const { state, value } = getModelState(model);
  return state === "pending" && value;
}

function error(model) {
  if (model === null || typeof model !== "object") return false;
  const { state, value } = getModelState(model);
  return state === "error" && value;
}

function ready(model) {
  if (model === null || typeof model !== "object") return false;
  return !!definitions.get(model);
}

function mapValueWithState(lastValue, nextValue) {
  const result = Object.freeze(
    Object.keys(lastValue).reduce((acc, key) => {
      Object.defineProperty(acc, key, {
        get: () => lastValue[key],
        enumerable: true,
      });
      return acc;
    }, Object.create(lastValue)),
  );

  definitions.set(result, definitions.get(lastValue));

  const { state, value } = getModelState(nextValue);
  return setModelState(result, state, value);
}

const draftMap = new WeakMap();

function getValuesFromModel(model) {
  const values = { ...model };
  delete values.id;
  return values;
}

function submit(draft) {
  const config = definitions.get(draft);
  if (!config || !draftMap.has(config)) {
    throw TypeError("Model instance is not a draft");
  }

  if (pending(draft)) {
    throw Error("Model instance in pending state");
  }

  const options = draftMap.get(config);
  let result;

  if (!options.id) {
    result = store.set(options.model, getValuesFromModel(draft));
  } else {
    const model = store.get(options.model, draft.id);
    result = Promise.resolve(pending(model) || model).then(resolvedModel =>
      store.set(resolvedModel, getValuesFromModel(draft)),
    );
  }

  result = result
    .then(resultModel => {
      return store
        .set(draft, getValuesFromModel(resultModel))
        .then(() => resultModel);
    })
    .catch(e => {
      setModelState(draft, "error", e);
      return Promise.reject(e);
    });

  setModelState(draft, "pending", result);

  return result;
}

function store(Model, options = {}) {
  const config = bootstrap(Model);

  if (typeof options !== "object") {
    options = { id: options };
  }

  if (options.id !== undefined && typeof options.id !== "function") {
    const id = options.id;
    options.id = host => host[id];
  }

  if (options.draft) {
    if (config.list) {
      throw TypeError(
        "Draft mode is not supported for listing model definition",
      );
    }

    Model = {
      ...Model,
      [store.connect]: {
        get(id) {
          const model = store.get(config.model, id);
          return ready(model) ? model : pending(model);
        },
        set(id, values) {
          return values === null ? { id } : values;
        },
      },
    };

    options.draft = bootstrap(Model);
    draftMap.set(options.draft, { model: config.model, id: options.id });
  }

  const createMode = options.draft && config.enumerable && !options.id;

  const desc = {
    get: (host, lastValue) => {
      if (createMode && !lastValue) {
        const nextValue = options.draft.create({});
        sync(options.draft, nextValue.id, nextValue);
        return store.get(Model, nextValue.id);
      }

      const id =
        options.draft && lastValue
          ? lastValue.id
          : options.id && options.id(host);

      const nextValue = store.get(Model, id);

      if (lastValue && nextValue !== lastValue && !ready(nextValue)) {
        return mapValueWithState(lastValue, nextValue);
      }

      return nextValue;
    },
    set: config.list
      ? undefined
      : (host, values, lastValue) => {
          if (!lastValue || !ready(lastValue)) lastValue = desc.get(host);

          if (!config.enumerable && error(lastValue)) {
            store.set(Model, values).catch(/* istanbul ignore next */ () => {});
          } else if (pending(lastValue)) {
            throw Error("Model instance in pending state");
          } else if (ready(lastValue)) {
            const result = store.set(lastValue, values);

            result.catch(/* istanbul ignore next */ () => {});
          } else {
            throw Error("Model instance is not in ready state");
          }

          return lastValue;
        },
    connect: options.draft ? () => () => clear(Model, false) : undefined,
  };

  return desc;
}

export default Object.assign(store, {
  // storage
  connect,

  // actions
  get,
  set,
  clear,

  // guards
  pending,
  error,
  ready,

  // helpers
  submit,
});
