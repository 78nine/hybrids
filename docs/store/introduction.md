# Introduction

The store provides global state management based on model definitions with built-in support for fetching data from external storages in a sync manner. It follows all of the library concepts, including extremely declarative approach. The store uses hybrids cache mechanism, so its state is always up to date inside of the components.

The store main goal is to shift the mindset to what you need rather than to how you get it. Let's create a web component, where we want to display some user model information. At first, we need to create a model definition in a plain object:

```javascript
import { store } from 'hybrids';
import { fetch } from 'fetch-some-api';

export const User = {
  id: true,
  firstName: '',
  lastName: '',
  [store.connect]: id => fetch(`/users/${id}`).then(res => res.data),
};
```

The above `User` model definition creates a structure for each user instance with predefined default values. The `true` value of the `id` property says that `User` is enumerable model, so there might be multiple instances with unique id provided by the storage. The `[store.connect]` configures the source of data (if omitted the data is taken from the memory).

Then we can use it inside of the `UserDetails` web component:

```javascript
import { store, html } from 'hybrids';
import { User } from './models.js';

const UserDetails = {
  userId: '1',
  user: store(User, 'userId'),
  render: ({ user }) => html`
    <div>
      ${store.pending(user) && `Loading...`}
      ${store.error(user) && `Something went wrong...`}

      ${store.ready(user) && html`
        <p>${user.firstName} ${user.lastName}</p>
      `}
    </div>
  `,
}
```

The `UserDetails` component uses `store` factory, which connects `user` property to its model instance with provided `userId`. Take a closer look, that there is no fetching process, which must be done manually. It is made under the hood by the store. If not directly defined, the model instances are permanently cached, so the storage is called only once (the cache might be set to time-based value or even turned off).

The store provides three guards (like `store.ready()`), which return information about the current state of the model instance. In that matter the store is unique as well - there might be more than one guard, which results with truthy value. For example, if the store looks for a new model (for example when `userId` changes), it still returns the last model until new is fetched. However, the template will show loading indicator as well. On another hand, if the fetching fails, the component still have the last value, but also with the error being shown. Moreover, the guards can work with any data passed from the store, so you might create standalone web component for displaying your loading & error states instead of using guards directly in each template!

Finally, the most important fact is that in the perspective of the `UserDetails` component, the way how the `User` data is fetched is irrelevant. The only thing that you care most is what kind of data you need and how you want to use it.
