/* eslint-disable @typescript-eslint/no-explicit-any */
import  assert  from 'node:assert';
import 'mocha';
import  Command  from '../../command/Command';  
import Cli from '../../Cli'

describe('Command', () => {

  beforeEach(() => {})


  describe ('Instance' , ()=>{
    beforeEach(() => {})

    it('instance', ()=>{
      const inst = new Command("start1", "start1 framawork")
      assert(inst)
      assert.equal(inst.name, "start1")
    })

    it('instance Cli', async ()=>{
      return  new Cli("NODE",{
        clear:false,
        autostart:false
    })
    .start()
    .then((cli )=>{
      new Command("start3", "start3 framawork", cli)
      const inst2 = new Command("start2", "start2 framawork", cli)
      assert(inst2)
      assert.equal(inst2.name, "start2")
      inst2.parse(["node","node", "start3", "-i", "-d" ])
    })
      

    })

  })


})