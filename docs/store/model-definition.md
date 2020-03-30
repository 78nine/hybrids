# Model Definition

The model definition is a plain object with JSON-like structure, which provides structure for the model instances. The model definition creates own global space for the data. The access to data is based on the reference to the definition, so there is no register step, which should be done programmatically. You can just define your model structure, and use it with the store.

Model definition might be a singleton, or have multiple instances with unique identifiers. Each instance of the model definition is immutable, so updating its state produces new version of the instance of the model. However, as model definition might reference other models, the model itself does not have to be updated if its related model changes.

## Type

```javascript
const Model = {
  id?: true,
  ...
}
```

The store supports three types of model definitions: singletons, enumerable model definition, and listing mode of the second type.

The `id` property is an indicator for the store if the model has multiple instances, or it is a singleton model. The only valid value for the `id` field is `true`. Otherwise, it should not be defined at all. For example, you may need only one instance of the `Profile` model of the current logged in user (which itself can have reference to the `User` model), but enumerable `User` model definition representing many users of the application.

The value for `id` property might be a `string`, or an `object` record (a map of primitive values). The latter is helpful for model definitions, which depend on some parameters. For example, `SearchResult` model definition can be identified by `{ query, order }` map of values.

For model instances created on the client side, the store set unique id (before sending data to the storage) using UUID v4 generator, so the memory based models have unique ids by default. The external storage might use client-side generated id, or return own identifier when new instance is created.

### Listing Mode

The store supports special type for listing enumerable models by the model definition closed inside of the array instance. However, the model definition still creates the connection, so the array wrapper might be added in-place. The listing model instance is an array with a list of models (it works similar as nested arrays explained below). For memory-based models it returns all instances of the model definition. It can be also used for models with an external storage (more information about that mode you can find in [storage](./storage.md) section).

```javascript
import { store, html } from 'hybrids';

const Todo = {
  id: true,
  desc: '',
  checked: false,
};

const MyElement = {
  todoList: store([Todo]),
  render: ({ todoList }) => html`
    <ul>
      ${store.ready(todoList) && todoList.map(todo => html`
        <li>
          <input type="checkbox" checked="${todo.checked}" />
          <span>${todo.desc}</span>
        </li>
      `)
    </ul>
  `,
};
```

The listing mode suits best for models, which can be represented as an array (like memory-based models). If the listing requires additional metadata (like pagination, offset, etc.) you should create separate model definition with nested array of required models.

The listing model instances respects the `cache` option of the storage, but the `loose` option is always turned on (it is the same feature as explained in the cache invalidation section below). It means, that a change made by the user to any instance of the model will invalidate the cache, and the next call for the list will fetch data again.

## Structure

The model definition structure is a subset of the JSON standard with minor changes. The model instance serializes to a string in form, which can be sent over the network without additional modification.

### Primitive Value

```javascript
const Model = {
  firstName: store.value('', /[A-Z]/),
  count: 0,
  checked: false,
  ...
};
```

The model definition supports primitive values with `string`, `number` or `boolean` type. The default value defines the type of the property. It works similar [transform feature](./property.md#transform) of the property factory. The type is always granted by the transform of values with the type constructor. For example, for strings it is the `String(value)`.

### Computed Value

```javascript
const Model = {
  firstName: 'Great',
  lastName: 'name!',
  // Model instance will have not enumerable property `fullName`
  fullName: ({ firstName, lastName }) => `${firstName} ${lastName}`,
}

// Somewhere with the model instance...
console.log(model.fullName); // logs "Great name!"
```

The computed property allows defining value based on other properties from the model. Its value is calculated only if the property is accessed. As the model instance is immutable, the result value is permanently cached - the function is called only once for the current state of the model. Also, as it is a result of other values of the model, that property is non-enumerable to prevent serializing its value to the storage (for example, `JSON.stringify()` won't use its value).

### Nested Object

The model definition supports two types of nested objects. They might be internal, where the value is stored inside of the model instance, or they can be external as model instances bound by the id.

The nested object structure is similar to the parent definition, so it could be used as a primary model definition as well. Because of that, the store must have a way to distinguish if the intention of the definition is an internal structure, or a external model definition. You can find how the store chooses the right option below.

#### Object Instance (Internal)

```javascript
const Model = {
  internal: {
    value: 'test',
    number: 0,
    ...
  },
};
```

If the nested structure does not provide `id` field, and it is not connected to the storage (by the `[store.connect]` property), the store assumes that this is an internal part of the parent model definition. As the result, the data will be attached to the model and it is not shared with other instances. Each model instance will have own nested values. All the rules of the model definition applies, so it might have own deep nested structures, etc.

#### Model Definition (External)

```javascript
const ModelWithId = {
  // It is enumerable
  id: true,
  ...
};

const SingletonFromStorage = {
  ...
  // It connects to the external storage
  [store.connect]: { ... },
};

const Model = {
  externalWithId: ModelWithId,
  externalSingleton: SingletonFromStorage,
};
```

If the nested object is a model definition with `id` property, or it is connected to the storage, it creates dynamic binding to the global model instance. Essentially, instead of setting value in-place, the property is defined as a getter, which calls the store for a model instance by the id (for singletons the id is always set to `undefined`). The relation is only one way - its the parent model, which creates connection to the nested one. The related model does not know about the connection automatically - it has only properties defined in its definition.

The value of that property fetched from the parent storage might be a model instance data (an object with values) or a valid identifier (the storage might have only the id to the other model). If the storage of the parent contains full data of the related model, it is treated as a newest version of that model instance, and values of the instance are replaced with the result. Otherwise, the store will use and save returned identifier. After all, calling that property will invoke the store to get proper model instance by its definition. It means, that you can create relations between data even from separate storages. The store will take care to get the data for you.

To indicate absence of the relation, the property should be set to `null` or `undefined`. In that case, the value of the nested external object will be set to `undefined`. Because of that, if the connection to the other model definition is optional, you have to protect access to this property manually (you can use `store.ready()` guard, which is truthy only for valid model instance).

### Nested Array

The store supports nested arrays in similar way to the nested objects described above. The first item of the array represent the type of structure - internal (primitives or object structures), or external reference to enumerable model definitions (by the `id` property).

#### Primitives or Nested Objects (Internal)

```javascript
const Model = {
  permissions: ['user', 'admin'],
  images: [
    { url: 'https://example.com/large.png', size: 'large' },
    { url: 'https://example.com/medium.png', size: 'medium' },
  ],
};
```

If the first item of the array is a primitive value or internal object instance (according to the rules defined for nested objects), the content of the array is unique for each model instance. Content of the definition is used as a default value for the property, including all of the items in the array. However, rest of the values will be transformed to the type of the first item.

#### Model Definitions (External)

```javascript
import OtherModel from './otherModel.js';

const Model = {
  items: [OtherModel],
};
```

If the first item of the array is a enumerable model definition, the property represents binding witg the list of external model instances by their ids (the singleton model definition is not supported for the obvious reason - use nested object feature instead). The storage of the parent model may provide a list of data for model instances or a list of identifiers. The update process and binding between models work the same as for single nested object.

#### Cache Invalidation

By default, the store does not invalidate cached value of the model instance when nested external models have changed. The list of nested models is treated as a hardly set one to many relation. Because of the nature of binding between models, if the nested model updates its state, it will be reflected without the update of the parent model.

However, the list in parent model might be related to the current state of nested models. For example, the model definition representing paginated structure ordered by name must update when one of the nested model changes. After the change, the result pages might have different order in the list. To support that case, you can pass a second object to the nested array definition with `loose` option:

```javascript
import { store } from 'hybrids';
import User from './user.js';

const UserList = {
  id: true,
  users: [User, { loose: true }],
  ...,
  [store.connect]: (params) => api.get('/users/search', params),
};

const pageOne = store.get(UserList, { page: 1, query: '' });

// Invalidates cached value of the `pageOne` model instance
store.set(pageOne[0], { name: 'New name' });
```

To prevent endless loop of fetching new values, the cached value of the parent model instance with `loose` option set to `true` only invalidates if the `store.set` method is used. It means, that updating the state of the nested model definition by fetching new values by `store.get` action won't invalidate parent model. Get action still respects the `cache` option of the parent storage (it's infinite for the memory-based models). This feature only tracks changes made by the user. If you need high rate of accuracy of external data, you should set a very low value of the `cache` option in the storage, or even set it to `false`.
