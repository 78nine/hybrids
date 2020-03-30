# Usage

```javascript
import { store } from 'hybrids';
```

The store provides two ways to interact with the data - the `store` factory and two main methods for direct access: `store.get()` and `store.set()`. Usually, all you need is a factory, which covers most of the cases. The direct access to the data might be required for more advanced structures. It is straight forward to create paginated view with a list of data with the factory, but for infinite scroll behavior you should display data from all of the pages, so you should call `store.get()` directly inside of other property getter.

## Direct

Even though the factory might be used more often than methods, its implementation is based on those methods. Because of that, it is important to understand how they work. 

The most important are following ground rules:

* `store.get()` always returns the current state of the model instance **synchronously**
* `store.set()` always updates model instance **asynchronously** using `Promise` API
* `store.get()` and `store.set()` always return an **object** (model instance, placeholder or promise instance)

Those unique principals unify access to async and sync source of data. From the user perspective it is irrelevant what kind of data source has the model. The store provides a special placeholder type, which is returned if there is no previous value of the model instance, the model instance is not found, it is in pending state, or error was returned. The placeholder protects access to its properties, so you won't use it by mistake (the guards methods help use the current state of the model instance properly).

### `store.get()`

```typescript
store.get(Model: object, parameters?: string | object) : object;
```

* **arguments**:
  * `Model: object` - a model definition
  * `parameters: string | object` - a string or an object representing parameters of the model instance
* **returns**:
  * Model instance or model instance placeholder

The store resolves data as soon as possible. If the model source is synchronous (memory-based, or sync external source, like `localStorage`) the get method returns an instance immediately. Otherwise, depending of the cached value and validation the placeholder might be returned instead. When the promise resolves, the next call to the store returns an instance. The cache mechanism takes care to notify the component, that data has changed (if you need to use this method outside of the component definition, you can use `store.pending()` gourd to access returned promise).

```javascript
const GlobalState = {
  count: 0,
};

function incCount(host) {
  store.set(GlobalState, { count: host.count + 1 });
}

const MyElement = {
  count: () => store.get(GlobalState).count,
  render: ({ count }) => html`
    <button onclick=${incCount}>${count}</button>
  `,
}
```

The above example uses singleton memory-based model, so the data is available instantly. The `count` property can be returned directly inside of the property definition. Even the `count` method does not relay on other properties, the `render` property will be notified when current value of the `GlobalState` changes (keep in mind that this approach creates a global state object, which is shared between all of the component instances).

### `store.set()`

The `store.set()` method can be used for creating a new instance of the model, or updating existing one. According to the mode, the first argument should be a model definition, or a model instance. The set method supports passing partial values, so omitted properties will use default or the last value of the property.

The set method uses Promise API regardless the type of the data source. The model values never updates synchronously. However, the current state of the model instance is updated. After calling set method the `store.pending()` guard will return truthy value, up to when promise is resolved.

#### Create

```typescript
store.set(Model: object, values: object) : Promise;
```

* **arguments**:
  * `Model: object` - a model definition
  * `values: object` - an object with partial values of the model instance
* **returns**:
  * A promise, which resolves with the model instance

```javascript
const Settings = {
  color: 'white',
  mode: 'lite',
  ...,
};

// Updates only the `mode` property
store.set(Settings, { mode: 'full' }).then(settings => {
  console.log(settings); // logs { color: 'white', mode: 'full', ... }
});
```

The singleton model has only one model instance, so it is irrelevant if you call `store.set` method by the model definition, or the model instance - the effect will be the same. For example, in the above code snippet `Settings` can have previous state, but setting new value by the model definition updates the already existing model instance.

#### Update

```typescript
store.set(modelInstance: object, values: object | null): Promise;
```

* **arguments**:
  * `modelInstance: object` - a model instance
  * `values: object | null` - an object with partial values of the model instance or `null` for deletion the model
* **returns**:
  * A promise, which resolves with the model instance or placeholder (for model deletion)

The only valid argument for values besides an object instance is a `null` pointer. It should be used to delete the model instance. However, as the last ground principle states, store always returns an object. If the model instance does not exists, the placeholder is returned in error state (with an error attached).

```javascript
function handleDeleteUser(host) {
  const { someUser } = host;

  store.set(someUser, null).then(someUser => {
    // someUser is now a placeholder with attached error
    console.log(store.error(someError)); // Logs an error "Not Found ..."
  });
}
```

## Factory

The factory defines a property descriptor connected to the store depending on the model definition configuration.

```typescript
store(Model: object, parameters?: string | (host) => string): object
```

* **arguments**:
  * `Model: object` - a model definition
  * `parameters: string | function` - a string pointing to the `host` property value by the key, or a function returning the parameters from the host
* **returns**:
  * hybrid property descriptor, which resolves to a store model instance

### Writable

If the model definition storage supports set action, the defined property will be writable (by the `store.set()` method).

```javascript
function updateUser(host, event) {
  const firstName = event.target.firstName.value;

  event.preventDefault();

  // updates `firstName` property of the user model instance
  host.user = { firstName };
}

const MyElement = {
  userId: '1',
  user: store(User, 'userId'),
  render: ({ user }) => html`
    ...
    <form onsubmit="${updateUser}">
      <input name="firstName" value="${user.firstName}" />
      ...
    </form>
  `,
};
```

### Singleton

If the model definition is a singleton, the parameters should be omitted.

```javascript
import { Settings } from './models.js';

const MyElement = {
  settings: store(Settings),
  color: ({ settings }) => settings.darkTheme ? 'white' : 'black',
  ...
};
```

### Enumerable

For enumerable model definition, when the second argument is set, the factory resolves to the model instance fetched by current value of the parameters. The parameters can be set by a host property name, or a function returning parameters value.

```javascript
import { User, SearchResult }  from './models.js';

const MyElement = {
  // Parameters from the host property (can be changed)
  userId: '1',
  user: store(User, 'userId'),


  // Parameters from the host properties
  order: 'asc',
  query: '',
  searchResult: store(SearchResult, ({ order, query }) => {
    return { order, query };
  }),
};
```

However, if the second argument is omitted, the factory allows creating a new instance of the enumerable model definition. Before the model is created, the store returns `null`, as there is no identifier yet. After successful setting values, the property will refer to the created instance. You can update values, delete it by setting `null` pointer to the property, or reset whole binding by setting property value to the `undefined` It means, that the model instance is disconnected from the property (this is the only exception when store accepts `undefined` as value).

```javascript
import { Product } from './models';

function createProduct(host, event) {
  ...
  // Creates a new instance of the model definition
  host.product = { name: ..., price: ... };
}

const MyElement = {
  product: store(Product),
  render: () => html`
    <h1>Add new product</h1>
    <form onsubmit="${createProduct}">
      ...
    </form>
  `
}
```

The important difference between using direct `store.get()` method and the factory for enumerable models is a special behavior implemented for returning the last instance even though the parameters have changed. The direct method always returns the data according to the passed arguments. On another hand, The factory caches the last value of the property, so when parameters change, the property still holds the previous state (before the next instance is ready). Additionally, the current state of the next value can be properly read.

```javascript
import { UserList } from './models';

function nextPage(host) {
  host.page += 1;
}

const MyElement = {
  page: 1,
  userList: store(UserList, 'page'),
  render: ({ userList, page }) => html`
    <style>
      ul.pending { opacity: 0.5 }
    </style>

    <ul class="${{ pending: store.pending(userList) }}">
      ${store.ready(userList) && userList.map(user => html`
        <li>${user.firstName} ${user.lastName}</li>
      `.key(user.id))}
    </ul>

    <button onclick=${nextPage}>Go to: ${page + 1}</button>
  `,
};
```

Lets assume that the above `UserList` model definition is enumerable by the page with the async storage. When the `page` property changes, the `userList` property is notified. The property gets a new data from the store, but in the meantime, it returns the last page with the current loading state (for the guards). Because of that, you can avoid situation when the user sees an empty screen with loading indicator, and still you can notify the user about the change.

## Guards

The store provides a set of three methods, which indicate the current state of the model instance. The returning value of those methods can be used for conditions in the template. Two of them contain additional information. Guards are not exclusive, so there are situation when more than one of the them returns truthy value.

### Ready

```typescript
store.ready(model: object): boolean
```

* **arguments**:
  * `model: object` - a model instance
* **returns**:
  * `true` for a valid model instance, `false` otherwise

The ready guard protects access to models with the async storage before they are fetched for the first time. You can also use it with sync storages, but if you are aware of the storage type, you can omit the guard.

The guard returns `true` only for a valid model instance. If the model has changed, the previous version of the model is not valid anymore, so for that object it will return `false`.

When the model instance is updated (by setting new value, or by cache invalidation), the store returns the last valid state of the model until new version is set. In that situation `store.ready()` still returns `true`. It is up to you if you want to display dirty state or not by combining ready guard with the pending one. It works the same if the update fails (then `store.error()` will be truthy as well). In simple words, the `store.ready()` always return `true`, if the model was resolved at least once.

```javascript
import { User } from './models.js';

const MyElement = {
  userId: '1',
  user: store(User),
  render: ({ user }) => html`
    ${store.ready(user) && html`
      <p>${user.firstName} ${user.lastName}</p>
    `}

    ${store.ready(user) && !store.pending(user) && html`
      <!-- This is hidden when 'userId' changes (until new user data is ready) -->
    `}
  `,
}
```

### Pending

```typescript
store.pending(model: object): boolean | Promise
```

* **arguments**:
  * `model: object` - a model instance
* **returns**:
  * In pending state a promise instance resolving with the next model value, `false` otherwise

The pending guard returns a promise, when model instance is get for async storages, or set for async and sync storages (`store.set()` method always use Promise API - look at the ground rules at the beginning of the section. If the model instance is returned from the cache (it is in stable state), the gourd returns `false`.

The pending and ready guards can both be truthy, if the already resolved model instance is being updated.

### Error

```typescript
store.error(model: object): boolean | Error | any
```

* **arguments**:
  * `model: object` - a model instance
* **returns**:
  * In error state an error instance or anything, which has been thrown, `false` otherwise
