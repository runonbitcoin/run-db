const txidFromLocation = (location) => {
  if (location.includes('berry')) {
    return location.split('?')[0].split('_')[0]
  } else {
    return location.split('_')[0]
  }
}

module.exports = { txidFromLocation }
