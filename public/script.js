document.getElementById('paymentForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const amount = parseFloat(document.getElementById('amount').value);
    const description = document.getElementById('description').value.trim();

    if (isNaN(amount) || amount <= 0) {
        displayResult('Please enter a valid amount greater than 0.');
        return;
    }
    if (!description) {
        displayResult('Please enter a description.');
        return;
    }

    // Prepare payment data according to TBC API requirements
    const paymentData = {
        amount: amount,
        currency: 'GEL',
        description: description,
        // Add other required fields here as per TBC API docs
    };

    try {
        const response = await fetch('/create-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            displayResult('Error creating payment: ' + (errorData.error || response.statusText));
            return;
        }

        const data = await response.json();

        // Assuming the API returns a payment URL to redirect the user to
        if (data.paymentUrl) {
            displayResult('Redirecting to payment page...');
            window.location.href = data.paymentUrl;
        } else {
            displayResult('Payment created successfully. Response:\n' + JSON.stringify(data, null, 2));
        }
    } catch (error) {
        displayResult('Error creating payment: ' + error.message);
    }
});

function displayResult(message) {
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = message;
}
