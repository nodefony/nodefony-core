import { expect } from 'chai';
import 'mocha';
import  nodefony  from '../index';  

describe('Index', () => {
   beforeEach(() => {})

  it('Index  Singleton', () => {
    const inst = new nodefony.Container()
    expect(inst).to.be.instanceOf(nodefony.Container)
    //console.log( kernel)
  });

})

