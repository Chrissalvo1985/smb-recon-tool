/**
 * In-memory sudo password from the last authenticated scan.
 * Used for NFS mount validation/browse when the process is not root.
 */
let sudoPassword = null;

module.exports = {
  set(password) {
    sudoPassword = password || null;
  },
  get() {
    return sudoPassword;
  },
  clear() {
    sudoPassword = null;
  }
};
