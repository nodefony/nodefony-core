import { expect } from "chai";
import supertest from "supertest";
import path from "path";
import "mocha";

const request = supertest("https://localhost:5152");

describe("File Upload Tests", () => {
  it("should upload a file successfully", (done) => {
    const filePath = path.resolve("nodefony", "config", "config.ts");

    request
      .post("/nodefony/test/html/upload")
      .disableTLSCerts()
      .attach("file", filePath)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        try {
          expect(res.body).to.be.an("array").that.is.not.empty;
          const uploadedFile = res.body[0];
          expect(uploadedFile).to.have.property("filename", "config.ts");
          expect(uploadedFile).to.have.property("size", 4200);
          expect(uploadedFile).to.have.property("mimeType", "video/mp2t");
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  it("should return an error if no file is uploaded", (done) => {
    request
      .post("/nodefony/test/html/uploaderror")
      .disableTLSCerts()
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        try {
          //console.log(res);
          res;
          //expect(res.text).to.equal("No file uploaded.");
          done();
        } catch (e) {
          done(e);
        }
      });
  });
});
