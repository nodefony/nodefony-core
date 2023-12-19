import { expect, assert } from 'chai';
import 'mocha';
import  nodefony ,{kernel} from '../index';  

describe('Index', () => {
   beforeEach(() => {})

  it('Index  Singleton', () => {
    const inst = new nodefony.Container()
    expect(inst).to.be.instanceOf(nodefony.Container)
    console.log( kernel)
  });

})

