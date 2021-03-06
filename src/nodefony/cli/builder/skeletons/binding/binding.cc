// {{shortName}}.cc
#include <node.h>

namespace {{shortName}} {

  using v8::FunctionCallbackInfo;
  using v8::Isolate;
  using v8::Local;
  using v8::NewStringType;
  using v8::Object;
  using v8::String;
  using v8::Value;

  void Method(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(String::NewFromUtf8(
      isolate, "With {{shortName}} binding c++", NewStringType::kNormal).ToLocalChecked());
  }

  void init(Local<Object> exports) {
    NODE_SET_METHOD(exports, "{{shortName}}", Method);
  }

  NODE_MODULE(NODE_GYP_MODULE_NAME, init)

}  //namespace {{shortName}}
