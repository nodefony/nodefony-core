function firewall() {
  return function (
    target: any,
    propertyKey: string,
    _descriptor: PropertyDescriptor
  ) {
    target[propertyKey].firewall = true;
  };
}

export { firewall };
