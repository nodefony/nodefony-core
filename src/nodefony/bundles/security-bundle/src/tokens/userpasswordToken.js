/*
 *	Token userPassword
 */

nodefony.registerToken("userPassword", function () {

  class userPasswordToken extends nodefony.Token {

    constructor(user, passwd) {
      super("userPassword");
      if (user) {
        this.setUser(new nodefony.User(user, passwd));
      }
    }

    unserialize(token) {
      if (token.user) {
        this.setUser(new nodefony.User(token.user.username));
      }
      return super.unserialize(token);
    }
  }
  return userPasswordToken;
});