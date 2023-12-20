/* eslint-disable @typescript-eslint/no-explicit-any */
import {  assert } from 'chai';
import 'mocha';
import {extend, isEmptyObject} from '../Tools'

describe("TOOLS extend", () => {

  describe("CONTRUSTROR ", () => {
    it("LIB LOADED", (done) => {
      assert.equal(typeof extend, "function");
      done();
    });
    it("Simple empty", (done) => {
      const res = extend();
      assert(isEmptyObject(res));
      done();
    });
  });

  describe("Simple Object", () => {
    it("Simple Object", (done) => {
      const myobj = {
        foo: "bar"
      };
      //let res = extend({});
      //assert(res === nodefony);
      let res = extend(true);
      assert(isEmptyObject(res));
      res = extend(myobj, {
        bar: "foo"
      });
      assert(res === myobj);
      let obj:{[key: string]: any} = {};
      res = extend(obj, myobj, {
        bar: "foo"
      });
      assert(res === obj);
      assert.equal(res.foo, "bar");
      assert.equal(res.bar, "foo");
      res = extend(myobj, {
        foo: "bar1"
      });
      assert(res === myobj);
      assert.equal(res.foo, "bar1");
      obj = {};
      res = extend(obj, myobj, {
        foo: "bar2"
      });
      assert.equal(myobj.foo, "bar1");
      assert.equal(obj.foo, "bar2");
      assert.equal(obj.bar, "foo");
      done();
    });

    it("Deep Object", (done) => {
      const myobj : {[key: string]: any} = {
        foo: {
          bar: {
            ele: 1,
            obj: 1
          }
        }
      };
      let res = extend(myobj, {
        bar: "foo"
      });
      assert(myobj.bar, "foo");
      let obj: any  = {};
      res = extend(obj, myobj, {
        bar: "foo1"
      });
      assert(res, obj);
      assert.equal(res.foo, myobj.foo);
      assert.equal(res.bar, "foo1");
      assert.equal(myobj.bar, "foo");
      assert.equal(res.foo.bar.ele, 1);
      obj = {};
      res = extend(obj, myobj, {
        foo: {
          bar: {
            ele: 2
          }
        }
      });
      assert.equal(res.bar, "foo");
      assert.equal(res.foo.bar.ele, 2);
      assert.equal(res.foo.bar.obj, undefined);
      obj = {};
      res = extend(true, obj, myobj, {
        foo: {
          bar: {
            ele: 3
          }
        }
      });
      assert.equal(res.bar, "foo");
      assert.equal(res.foo.bar.ele, 3);
      assert.equal(res.foo.bar.obj, 1);
      obj = {};
      res = extend(true, obj, myobj, {
        bar: "foo"
      });
      assert(res, obj);
      assert.notEqual(res.foo, myobj.foo);
      done();
    });
  });

  describe("Extend with Array", () => {
    it("Simple", (done) => {
      const myArray = [1, 2, 3];
      //let res = extend(myArray);
      //assert.equal(res, nodefony);
      const myobj = {
        tab: myArray,
        foo: "bar"
      };
      let res = extend({}, myobj);
      assert.equal(res.tab, myArray);
      res = extend(true, {}, myobj);
      assert.notEqual(res.tab, myArray);

      const tab = [4, 5, 6];
      res = extend({}, myobj, {
        tab
      });
      assert.equal(res.tab, tab);
      res = extend(true, {}, myobj, {
        tab
      });
      assert.notEqual(res.tab, tab);
      done();
    });
  });
});
