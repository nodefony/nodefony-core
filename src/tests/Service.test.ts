import 'mocha';
import assert from 'node:assert'
import Service  from '../Service'


declare global {
  interface NodeJSGlobal {
    service: Service;
  }
}
declare let global: NodeJS.Global & { service?: Service };


describe("NODEFONY Service", () => {

  describe("namespace", () => {

     before(() => {
      global.service = new Service("test");
    });
    it("register", (done) => {
      assert(Service);
      assert(global.service instanceof Service);
      done();
    });

  })





})