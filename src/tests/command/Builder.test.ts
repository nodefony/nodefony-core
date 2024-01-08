// Builder.test.ts
//mport fs from 'node:fs'
import { expect } from 'chai';
import 'mocha';
import Builder, {BuilderObject}from '../../command/Builder';
import path from 'path';
import Cli from '../../Cli';
import Command from '../../command/Command';

describe('FileManager', () => {
  let builder: Builder;
  let cli :Cli ; 
  beforeEach(async () => {
    cli = new Cli("NODE",{
        clear:false,
        asciify:false,
        autostart:false
    })
     builder = new Builder(new Command("start", "start framawork", cli));
  });

  it('devrait construire un répertoire', async () => {
    // Définissez vos données de test
    const objetRepertoire: BuilderObject = {
      name: 'testRepertoire',
      type: 'directory'
    };
    const resultat = await builder.build(objetRepertoire,  path.resolve(process.cwd(), "tmp") ,true);
    expect(resultat).not.to.be.null;
    expect(resultat?.name).to.equal('testRepertoire');
  });

  it('devrait construire un fichier', async () => {
    // Définissez vos données de test
    const objetFichier: BuilderObject = {
      name: 'testFichier',
      type: 'file'
    };
    const resultat = await builder.build(objetFichier, path.resolve(process.cwd(), "tmp") );
    //console.log(resultat)
    expect(resultat).not.be.null
  });

   it('devrait créer un symlink', async () => {
    const objetSymlink: BuilderObject = {
      name: 'testSymlink',
      type: 'symlink',
      params: {
        source: path.resolve(process.cwd(), "tmp",'testFichier'),
        dest: path.resolve(process.cwd(), "tmp", 'testSymlink'),
      },
    };
    const resultat = await builder.build(objetSymlink, path.resolve(process.cwd(), "tmp") , true);
    expect(resultat).not.be.null;
    //console.log(resultat)
  });

  it('devrait construire un répertoire avec des enfants de manière récursive', async () => {
    //await fs.promises.mkdir(path.resolve(process.cwd(), "tmp",'sboob'), { mode: 0o755 });
    const objetParent: BuilderObject = {
      name: 'parentDirectory',
      type: 'directory',
      childs: [{
          name: 'childFile',
          type: 'file',
        }, {
          name: 'childDirectory',
          type: 'directory',
          childs: [{
              name: 'grandchildFile',
              type: 'file',
          }],
      }]
    };
    const parentDirectory = await builder.build(objetParent,  path.resolve(process.cwd(), "tmp"), true);
    expect(parentDirectory).to.not.be.null;
    expect(parentDirectory?.name).to.equal('parentDirectory');
    //console.log(parentDirectory)
    
  });

   it('devrait copier un fichier avec succès', async () => {
  
    const destinationFile: BuilderObject = {
      name: 'src',
      type: 'copy',
      path:  path.resolve(process.cwd(), 'src',"tests"),
      params: {
        recurse: true,  // Exemple de paramètre pour une copie récursive
      }
    };
    // Utilisez la fonction de copie
     await builder.build(destinationFile, path.resolve(process.cwd(), "tmp"));

  });
  
});
