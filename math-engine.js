var MathEngine = {
    // 1. LOCKED GLOBAL ASSUMPTIONS
    Constants: {
        HomePrice: 500000,
        DownPaymentTarget: 100000, // 20%
        CurrentLiquidWealth: 65000,
        EmergencyBuffer: 15000,
        InvestableStart: 50000, // 65k - 15k
        MonthlySavings: 1500,

        MortgageRate: 0.055, // 5.5%
        AmortizationYears: 25,

        FHSARate: 0.05,
        HISARate: 0.045,
        MarketReturn: 0.06,

        TaxRate: 0.30
    },

    // 1. RENT & INVEST (Control)
    // Goal: Maximize Liquid Net Worth
    // Math: Investable (50k) grows at 6%. Monthly savings (1.5k) grow at 6%.
    // Horizon: Fixed 5 Years (60 months)
    getRentProfile: function () {
        const C = this.Constants;
        // FV Lump Sum
        let fvLump = this.fvLumpSum(C.InvestableStart, C.MarketReturn, 5);
        // FV Series
        let fvSeries = this.fvSeries(C.MonthlySavings, C.MarketReturn, 5);

        let netWorth = fvLump + fvSeries;

        return {
            netWorth: netWorth,
            returnRate: C.MarketReturn * 100 // 6.0
        };
    },

    // 2. BUY NOW (Pain)
    // Goal: What can I afford TODAY?
    // Math: Down Payment = Investable (50k).
    // Mortgage = Price (500k) - 50k + CMHC Insurance.
    getBuyNowProfile: function () {
        const C = this.Constants;
        const downPayment = C.InvestableStart; // 50k
        const dpPercent = downPayment / C.HomePrice; // 10%

        // CMHC Rules (Simplified for 10% down -> 3.10%)
        let insuranceRate = 0;
        if (dpPercent < 0.20) {
            insuranceRate = 0.0310;
        }

        let mortgagePrincipal = C.HomePrice - downPayment;
        let insuranceCost = mortgagePrincipal * insuranceRate;
        let totalMortgage = mortgagePrincipal + insuranceCost;

        let monthlyPayment = this.calculatePMT(C.MortgageRate, C.AmortizationYears, totalMortgage);

        return {
            principal: totalMortgage,
            monthlyPayment: monthlyPayment,
            isHighRatio: (dpPercent < 0.20),
            insuranceCost: insuranceCost,
            liquidityRemaining: C.EmergencyBuffer // 15k
        };
    },

    // 3. SMART WAIT (Hero)
    // Goal: Reach 20% Down Payment ($100k)
    // Math: 
    // - Initial: $65k (Current Liquid) in HISA @ 4.5%
    // - Monthly: FHSA $666 @ 5%, Rest $834 @ 4.5%
    // - Tax Refund: 30% of FHSA ($199.80) reinvested in HISA
    // - Loop until (TotalWealth - Buffer) >= $100k
    getSmartWaitProfile: function () {
        const C = this.Constants;
        const savingsTotal = C.MonthlySavings; // 1500
        const fhsaCont = 666; // $8k/yr
        const hisaCont = savingsTotal - fhsaCont; // 834-ish
        const refund = fhsaCont * C.TaxRate; // ~200

        // Loop to find Month X
        let months = 0;
        let found = false;
        let finalWealth = 0;
        let finalAvailable = 0;

        // Limit loop to 10 years (120 months) to prevent infinite
        for (let m = 1; m <= 120; m++) {
            // Growth
            // HISA Bal: 65k grows + (834+200) contributions
            let hisaBal = this.fvLumpSum(C.CurrentLiquidWealth, C.HISARate, m / 12) +
                this.fvSeries(hisaCont + refund, C.HISARate, m / 12);

            // FHSA Bal: 666 contributions
            let fhsaBal = this.fvSeries(fhsaCont, C.FHSARate, m / 12);

            let total = hisaBal + fhsaBal;
            let available = total - C.EmergencyBuffer;

            if (!found && available >= C.DownPaymentTarget) {
                months = m;
                found = true;
                finalWealth = total;
                finalAvailable = available;
            }

            // If we are at the "found" month, capture state
            if (found && m === months) {
                break;
            }
        }

        if (!found) {
            months = 120; // Cap
            // Recalc for 120
            let hisaBal = this.fvLumpSum(C.CurrentLiquidWealth, C.HISARate, 10) +
                this.fvSeries(hisaCont + refund, C.HISARate, 10);
            let fhsaBal = this.fvSeries(fhsaCont, C.FHSARate, 10);
            finalWealth = hisaBal + fhsaBal;
            finalAvailable = finalWealth - C.EmergencyBuffer;
        }

        // Comparison: Mortgage if we buy at Month X vs Buy Now info
        // Buy Now: 500k home, 50k down -> 450k mortgage + insurance
        // Smart Wait: 500k home, 100k down -> 400k mortgage, NO insurance
        let buyNow = this.getBuyNowProfile();

        let smartPrincipal = C.HomePrice - C.DownPaymentTarget; // 400k
        // Conventional Mortgate (20% down) -> No Insurance
        let smartPmt = this.calculatePMT(C.MortgageRate, C.AmortizationYears, smartPrincipal);

        // Acceleration Logic:
        // User pays the "Buy Now" amount ($2850) instead of "Smart Wait" amount ($2450).
        // Difference goes to principal.
        let paymentDiff = buyNow.monthlyPayment - smartPmt;
        let yearsSaved = 0;
        if (paymentDiff > 0) {
            // How long to pay off 400k paying (smartPmt + diff) = buyNow.monthlyPayment?
            let nMonths = this.calculatePayoffMonths(C.MortgageRate, smartPrincipal, buyNow.monthlyPayment);
            let originalMonths = C.AmortizationYears * 12;
            let savedMonths = originalMonths - nMonths;
            yearsSaved = savedMonths / 12;
        }

        return {
            readyMonths: months,
            totalWealth: finalWealth,
            availableDP: finalAvailable,
            monthlyPayment: smartPmt,
            comparison: {
                yearsSaved: yearsSaved,
                paymentDiff: paymentDiff
            }
        };
    },

    // --- HELPERS ---
    fvLumpSum: function (pv, rate, years) {
        return pv * Math.pow(1 + rate, years);
    },

    // FV of a series of monthly payments (end of period)
    // Rate is annual
    fvSeries: function (pmt, rate, years) {
        let r = rate / 12;
        let n = years * 12;
        return pmt * ((Math.pow(1 + r, n) - 1) / r);
    },

    calculatePMT: function (rate, years, principal) {
        let r = rate / 12;
        let n = years * 12;
        return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    },

    calculatePayoffMonths: function (rate, principal, payment) {
        let r = rate / 12;
        // NPER = -log(1 - (r*PV)/PMT) / log(1+r)
        // Ensure payment covers interest
        if (payment <= principal * r) return 999;
        let numerator = -Math.log(1 - (principal * r) / payment);
        let denominator = Math.log(1 + r);
        return numerator / denominator;
    }

};

// Attach to window just in case
window.MathEngine = MathEngine;
