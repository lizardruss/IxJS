import { OperatorAsyncFunction } from '../interfaces';
import { bindCallback } from '../internal/bindcallback';
import { identityAsync } from '../internal/identity';
import { toLength } from '../internal/tolength';
import { isArrayLike, isIterable, isAsyncIterable } from '../internal/isiterable';
import { Observable } from '../observer';

/**
 * This clas serves as the base for all operations which support [Symbol.asyncIterator].
 */
export abstract class AsyncIterableX<T> implements AsyncIterable<T> {
  abstract [Symbol.asyncIterator](): AsyncIterator<T>;

  async forEach(
    projection: (value: T, index: number) => void | Promise<void>,
    thisArg?: any
  ): Promise<void> {
    const fn = bindCallback(projection, thisArg, 2);
    let i = 0;
    for await (let item of this) {
      await fn(item, i++);
    }
  }

  pipe<R>(...operations: OperatorAsyncFunction<T, R>[]): AsyncIterableX<R> {
    if (operations.length === 0) {
      return this as any;
    }

    const piped = (input: AsyncIterable<T>): AsyncIterableX<R> => {
      return operations.reduce(
        (prev: any, fn: OperatorAsyncFunction<T, R>) => fn(prev),
        input as any
      );
    };

    return piped(this);
  }

  static from<TSource, TResult = TSource>(
    source: AsyncIterableInput<TSource> | TSource,
    selector: (value: TSource, index: number) => TResult | Promise<TResult> = identityAsync,
    thisArg?: any
  ): AsyncIterableX<TResult> {
    const fn = bindCallback(selector, thisArg, 2);
    /* tslint:disable */
    if (isIterable(source) || isAsyncIterable(source)) {
      return new FromAsyncIterable<TSource, TResult>(source, fn);
    }
    if (isPromise(source)) {
      return new FromPromiseIterable<TSource, TResult>(source, fn);
    }
    if (isObservable(source)) {
      return new FromObservableAsyncIterable<TSource, TResult>(source, fn);
    }
    if (isArrayLike(source)) {
      return new FromArrayIterable<TSource, TResult>(source, fn);
    }
    return new FromAsyncIterable<TSource, TResult>(
      new OfAsyncIterable<TSource>([source as TSource]),
      fn
    );
    /* tslint:enable */
  }

  static of<TSource>(...args: TSource[]): AsyncIterableX<TSource> {
    //tslint:disable-next-line
    return new OfAsyncIterable<TSource>(args);
  }
}

class FromArrayIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: ArrayLike<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: ArrayLike<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    let i = 0;
    const length = toLength((<ArrayLike<TSource>>this._source).length);
    while (i < length) {
      yield await this._selector(this._source[i], i++);
    }
  }
}

class FromAsyncIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: Iterable<TSource | PromiseLike<TSource>> | AsyncIterable<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: Iterable<TSource | PromiseLike<TSource>> | AsyncIterable<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    let i = 0;
    for await (let item of <AsyncIterable<TSource>>this._source) {
      yield await this._selector(item, i++);
    }
  }
}

class FromPromiseIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _source: PromiseLike<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    source: PromiseLike<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._source = source;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    const item = await this._source;
    yield await this._selector(item, 0);
  }
}

class AsyncObserver<TSource> {
  public values: TSource[];
  public hasError: boolean;
  public hasCompleted: boolean;
  public errorValue: any;
  public closed: boolean;

  constructor() {
    this.values = [];
    this.hasCompleted = false;
    this.hasError = false;
    this.errorValue = null;
    this.closed = false;
  }

  next(value: TSource) {
    if (!this.closed) {
      this.values.push(value);
    }
  }

  error(err: any) {
    if (!this.closed) {
      this.closed = true;
      this.hasError = true;
      this.errorValue = err;
    }
  }

  complete() {
    if (!this.closed) {
      this.closed = true;
    }
  }
}

class FromObservableAsyncIterable<TSource, TResult = TSource> extends AsyncIterableX<TResult> {
  private _observable: Observable<TSource>;
  private _selector: (value: TSource, index: number) => TResult | Promise<TResult>;

  constructor(
    observable: Observable<TSource>,
    selector: (value: TSource, index: number) => TResult | Promise<TResult>
  ) {
    super();
    this._observable = observable;
    this._selector = selector;
  }

  async *[Symbol.asyncIterator]() {
    const observer = new AsyncObserver<TSource>();
    const subscription = this._observable.subscribe(observer);

    let i = 0;
    while (1) {
      if (observer.values.length > 0) {
        yield await this._selector(observer.values.shift()!, i++);
      } else if (observer.closed) {
        subscription.unsubscribe();
        if (observer.hasError) {
          throw observer.errorValue;
        } else {
          break;
        }
      }
    }
  }
}

export type AsyncIterableInput<TSource> =
  | AsyncIterable<TSource>
  | Iterable<TSource | PromiseLike<TSource>>
  | ArrayLike<TSource>
  | PromiseLike<TSource>
  | Observable<TSource>;

function isPromise(x: any): x is PromiseLike<any> {
  return x != null && Object(x) === x && typeof x['then'] === 'function';
}

function isObservable(x: any): x is Observable<any> {
  return x != null && Object(x) === x && typeof x['subscribe'] === 'function';
}

class OfAsyncIterable<TSource> extends AsyncIterableX<TSource> {
  private _args: TSource[];

  constructor(args: TSource[]) {
    super();
    this._args = args;
  }

  async *[Symbol.asyncIterator]() {
    for (let item of this._args) {
      yield item;
    }
  }
}

declare module '../asynciterable/asynciterablex' {
  interface AsyncIterableX<T> {
    pipe(): AsyncIterableX<T>;
    pipe<A>(op1: OperatorAsyncFunction<T, A>): AsyncIterableX<A>;
    pipe<A, B>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>
    ): AsyncIterableX<B>;
    pipe<A, B, C>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>
    ): AsyncIterableX<C>;
    pipe<A, B, C, D>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>
    ): AsyncIterableX<D>;
    pipe<A, B, C, D, E>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>
    ): AsyncIterableX<E>;
    pipe<A, B, C, D, E, F>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>
    ): AsyncIterableX<F>;
    pipe<A, B, C, D, E, F, G>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>
    ): AsyncIterableX<G>;
    pipe<A, B, C, D, E, F, G, H>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>,
      op8: OperatorAsyncFunction<G, H>
    ): AsyncIterableX<H>;
    pipe<A, B, C, D, E, F, G, H, I>(
      op1: OperatorAsyncFunction<T, A>,
      op2: OperatorAsyncFunction<A, B>,
      op3: OperatorAsyncFunction<B, C>,
      op4: OperatorAsyncFunction<C, D>,
      op5: OperatorAsyncFunction<D, E>,
      op6: OperatorAsyncFunction<E, F>,
      op7: OperatorAsyncFunction<F, G>,
      op8: OperatorAsyncFunction<G, H>,
      op9: OperatorAsyncFunction<H, I>
    ): AsyncIterableX<I>;
    pipe<R>(...operations: OperatorAsyncFunction<T, R>[]): AsyncIterableX<R>;
  }
}
