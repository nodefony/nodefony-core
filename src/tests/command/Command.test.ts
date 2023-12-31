/* eslint-disable @typescript-eslint/no-explicit-any */
import  assert  from 'node:assert';
import 'mocha';
import  Command  from '../../command/command';  

describe('Command', () => {

  beforeEach(() => {})


  describe ('Instance' , ()=>{
    beforeEach(() => {})

    it('instance', ()=>{
      const inst = new Command("start")
      assert(inst)
      assert.equal(inst.name, "start")
    })

  })


})