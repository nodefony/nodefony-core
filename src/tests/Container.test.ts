import { expect, assert } from 'chai';
import 'mocha';
import  Container  from '../Container';  

declare namespace NodeJS {
  interface Global {
    container :Container
  }
}

declare var global: NodeJS.Global & { container?: Container };

class myClass{
  name: string
  constructor(name: string){
    this.name = name
  }
}
class myClass2{
  name: string
  constructor(name: string){
    this.name = name
  }
}

class myClass3{
  name: string
  constructor(name: string){
    this.name = name
  }
}

describe('Container', () => {

  beforeEach(() => {
    if ('container' in global) {
      delete (global as any).container; 
    }
    global.container = new Container();
       // Ajout d'un service
    global.container.set('service1', function () {
      console.log('Service 1');
    });
    global.container.set('myclass' , new myClass('test'))
  });

  it('Container set and get services', () => {
    // Récupération du service
    expect(global.container.get('service1')).to.be.a('function');
    expect(global.container.get('myclass')).to.be.instanceOf(myClass)
  });

  it('Container set and get parameters', () => {
    // Récupération du service
    global.container.setParameters("foo.bar", "test")
    expect(global.container.getParameters("foo.bar")).eq("test")
    assert.throws(() =>{
      global.container.setParameters("foo.bar.ele", {})
    }, Error, "Cannot create property 'ele' on string 'test'")
    let obj = {}
    global.container.setParameters("foo.bar", obj)
    expect(global.container.getParameters("foo.bar")).to.be.an("object")
    expect(global.container.getParameters("foo")).to.be.an("object")
    expect(global.container.getParameters("foo")).to.include({ bar: obj });
  });

  it('Container Scope', () => {
    global.container.addScope("myscope")
    const scopeContainer = global.container.enterScope("myscope")
    global.container.addScope("myscope2")
    const scopeContainer2 = global.container.enterScope("myscope2")
    expect(scopeContainer.get('service1')).to.be.a('function');
    expect(scopeContainer.get('myclass')).to.be.instanceOf(myClass)
    expect(scopeContainer2.get('service1')).to.be.a('function');
    expect(scopeContainer2.get('myclass')).to.be.instanceOf(myClass)
  })

  it('Container Scope set and get parameters', () => {
    let obj = {}
    global.container.setParameters("foo.bar", obj)
    global.container.addScope("myscope")
    const scopeContainer = global.container.enterScope("myscope")
    //console.log(scopeContainer)
    //console.log(global.container, scopeContainer.parameters, global.container.parameters)
    expect(scopeContainer.getParameters("foo.bar")).to.be.an("object")
    expect(scopeContainer.getParameters("foo")).to.be.an("object")
    expect(scopeContainer.getParameters("foo")).to.include({ bar: obj });
    scopeContainer.setParameters("foo.bar", "test")
    //console.log(scopeContainer.getParameters("foo.bar") )
    expect(scopeContainer.getParameters("foo.bar")).equal("test")
    //console.log(scopeContainer)
    expect(global.container.getParameters("foo")).to.include({ bar: obj });
  })

  it('Container Scope add service on scope', () => {
    global.container.addScope("myscope")
    const scopeContainer = global.container.enterScope("myscope")
    global.container.addScope("myscope2")
    const scopeContainer2 = global.container.enterScope("myscope2")
    scopeContainer.set('myclass2' , new myClass2('test2'))
    expect(scopeContainer.get('myclass2') ).to.be.instanceOf(myClass2)
    expect(global.container.get('myclass2')).to.be.null
    expect(scopeContainer2.get('myclass2')).to.be.null
  })

  it('Container Scope add service on main container', () => {
    global.container.addScope("myscope")
    const scopeContainer = global.container.enterScope("myscope")
    global.container.addScope("myscope2")
    const scopeContainer2 = global.container.enterScope("myscope2")
    global.container.set('myclass3' , new myClass3('test3')) 
    expect(scopeContainer.get('myclass3') ).to.be.instanceOf(myClass3)
    expect(scopeContainer2.get('myclass3') ).to.be.instanceOf(myClass3)
 })

});
