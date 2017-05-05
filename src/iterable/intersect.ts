'use strict';

import { arrayIndexOf } from '../internal/arrayindexof';
import { comparer as defaultComparer } from '../internal/comparer';

function arrayRemove<T>(array: T[], item: T, comparer: (x: T, y: T) => boolean): boolean {
  let idx = arrayIndexOf(array, item, comparer);
  if (idx === -1) { return false; }
  array.splice(idx, 1);
  return true;
}

export function* intersect<T>(
      first: Iterable<T>,
      second: Iterable<T>,
      comparer: (x: T, y: T) => boolean = defaultComparer): Iterable<T> {
  let map = [];
  for (let firstItem of first) {
    map.push(firstItem);
  }

  for (let secondItem of second) {
    if (arrayRemove(map, secondItem, comparer)) {
      yield secondItem;
    }
  }
}