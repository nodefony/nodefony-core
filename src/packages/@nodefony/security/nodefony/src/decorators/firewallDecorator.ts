function firewall() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    target[propertyKey].firewall = true;
  };
}

export { firewall };
