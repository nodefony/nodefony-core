import {  assert } from 'chai';
import 'mocha';
import FileClass from '../FileClass'


describe("NODEFONY CORE FINDER", () => {

   before( () => {
      try{
        console.log(FileClass)
        assert.isDefined(FileClass)
      }catch(e){
        console.error(e)
      }
  });






})